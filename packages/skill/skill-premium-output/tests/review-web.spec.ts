/** The bundled script runs against a real loopback page without installing dependencies or browsers. */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../../..')
const script = resolve(import.meta.dirname, '../skills/premium-web-experience/scripts/review-web.mjs')
const webCwd = resolve(root, 'apps/web')
const execFileAsync = promisify(execFile)
const cleanup: (() => Promise<unknown>)[] = []
const candidateBrowser = process.env['PREMIUM_REVIEW_TEST_BROWSER'] ?? (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '')
const browser = candidateBrowser && existsSync(candidateBrowser) ? candidateBrowser : undefined
let hasPlaywright = false
try { createRequire(resolve(webCwd, 'package.json')).resolve('playwright'); hasPlaywright = true } catch { /* Browser tests skip when the optional web test dependency is absent. */ }

interface Options {
  help: boolean
  url?: string
  out?: string
  browser?: string
  readySelector?: string
  storageState?: string
  allowRemote: boolean
  timeout: number
}
interface Helper {
  parseArgs(argv: string[]): Options
  isAllowedUrl(value: string, allowRemote?: boolean): boolean
  diagnosticText(value: unknown): string
  launchRemediation(message: string, platform: string): string
  runReview(options: Options, cwd: string): Promise<{ report: ReviewReport; directory: string; exitCode: number }>
}
// The shipped JavaScript asset stays outside the package's TypeScript emission.
const helper = await import(pathToFileURL(script).href) as Helper

afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

async function fixture(html: string, requiredCookie?: string): Promise<string> {
  const server = createServer((request, response) => {
    if (requiredCookie && !request.headers.cookie?.includes(requiredCookie)) {
      response.writeHead(401, { 'Content-Type': 'text/plain' }).end('Unauthorized')
    } else if (request.url?.startsWith('/missing')) {
      response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Missing')
    } else response.writeHead(200, { 'Content-Type': 'text/html' }).end(html)
  })
  await new Promise<void>(resolveReady => server.listen(0, '127.0.0.1', resolveReady))
  cleanup.push(() => new Promise<void>((resolveClosed, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolveClosed()
    })
    server.closeAllConnections()
  }))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture has no TCP address.')
  return `http://127.0.0.1:${address.port}`
}

interface ReviewReport {
  status: string
  target: string
  visualQualityAssessed: boolean
  remediation?: string
  views: {
    screenshot: string | null
    ready: boolean | null
    settling: { fontsReady: boolean; finiteAnimationsObserved: number; unfinishedFiniteAnimations: number; timedOut: boolean }
    issues: { kind: string; detail: string }[]
    omittedIssues: number
    dom: {
      horizontalOverflow: boolean
      reducedMotion: boolean
      counts: { failedImages: number; unlabeledControls: number }
      samples: { unlabeledControls: string[] }
    }
  }[]
}

interface StdoutSummary {
  directory: string
  report: string
  screenshots: { name: string; path: string }[]
  lookNote: string
}

interface RunResult { report: ReviewReport; directory: string; exitCode: number; stdout: StdoutSummary }

async function run(url: string, extra: string[] = []): Promise<RunResult> {
  const out = await mkdtemp(resolve(tmpdir(), 'saturn-browser-review-'))
  cleanup.push(() => rm(out, { recursive: true, force: true }))
  const args = [script, '--url', url, '--out', out, ...(!extra.includes('--timeout') ? ['--timeout', '5000'] : []), ...(browser && !extra.includes('--browser') ? ['--browser', browser] : []), ...extra]
  let stdout: string
  let exitCode = 0
  try {
    stdout = (await execFileAsync(process.execPath, args, { cwd: webCwd, timeout: 45000, maxBuffer: 65536 })).stdout
  } catch (error) {
    const failed = error as { stdout?: string; code?: number | string }
    if (typeof failed.stdout !== 'string' || typeof failed.code !== 'number') throw error
    stdout = failed.stdout
    exitCode = failed.code
  }
  const output = JSON.parse(stdout) as StdoutSummary
  return { report: JSON.parse(await readFile(output.report, 'utf8')) as ReviewReport, directory: output.directory, exitCode, stdout: output }
}

describe('bundled browser review', () => {
  it('requires explicit authorization for remote preview URLs and refuses ambiguous arguments', () => {
    expect(helper.isAllowedUrl('http://127.0.0.1:3000')).toBe(true)
    expect(helper.isAllowedUrl('http://[::1]:3000')).toBe(true)
    expect(helper.isAllowedUrl('https://example.com')).toBe(false)
    expect(helper.isAllowedUrl('https://example.com', true)).toBe(true)
    expect(helper.isAllowedUrl('file:///etc/passwd', true)).toBe(false)
    expect(helper.isAllowedUrl('http://user:password@localhost')).toBe(false)
    expect(helper.isAllowedUrl('http://localhost.example.com')).toBe(false)
    expect(() => helper.parseArgs(['--url', 'http://localhost', '--url', 'http://example.com', '--out', '.'])).toThrow('Repeated')
    expect(() => helper.parseArgs(['--url', 'http://localhost', '--out', '.', '--timeout', '60000'])).toThrow('1000 to 30000')
    expect(() => helper.parseArgs(['--url', 'http://localhost', '--out', '--help'])).toThrow('Missing')
    expect(helper.parseArgs(['--url', 'https://example.com', '--allow-remote', '--out', '.']).allowRemote).toBe(true)
  })

  it('removes URL credentials and query values from bounded diagnostic text', () => {
    const text = helper.diagnosticText(`Failed https://user:password@example.com/path?token=secret#private\n${'x'.repeat(1000)}`)
    expect(text).toContain('https://example.com/path')
    expect(text).not.toMatch(/password|secret|private|\n/)
    expect(text.length).toBe(300)
  })

  it('distinguishes a Windows launch denial from missing tooling without claiming an exact policy cause', () => {
    const denied = helper.launchRemediation('browserType.launch: spawn EPERM', 'win32')
    expect(denied).toContain('no screenshots were captured')
    expect(denied).toContain('can block the pipes Playwright requires')
    expect(denied).toContain('authorized browser integration')
    expect(denied).toContain('preserves shell policy')
    expect(denied).toContain('Do not automatically disable the sandbox')
    expect(denied).not.toContain('configure Playwright')
    for (const message of ['Playwright is unavailable', "Executable doesn't exist at C:/missing.exe", 'connect EPERM']) {
      expect(helper.launchRemediation(message, 'win32')).toContain('configure Playwright')
      expect(helper.launchRemediation(message, 'win32')).not.toContain('Windows denied')
    }
    expect(helper.launchRemediation('spawn EPERM', 'linux')).not.toContain('Windows denied')
  })

  it.skipIf(process.platform !== 'win32')('writes Windows launch-denial guidance to both report formats and creates no screenshots', async () => {
    const project = await mkdtemp(resolve(tmpdir(), 'saturn-review-denial-'))
    cleanup.push(() => rm(project, { recursive: true, force: true }))
    const module = resolve(project, 'node_modules/playwright')
    await mkdir(module, { recursive: true })
    // Only the external browser launch is simulated; run the shipped helper's
    // dependency resolution, error handling, exit result, and artifact writes.
    await writeFile(resolve(module, 'package.json'), '{"name":"playwright","main":"index.cjs"}')
    await writeFile(resolve(module, 'index.cjs'), 'exports.chromium={launch:async()=>{throw new Error("browserType.launch: spawn EPERM")}}')
    const options = helper.parseArgs(['--url', 'http://127.0.0.1:1', '--out', resolve(project, 'evidence')])
    const { report, directory, exitCode } = await helper.runReview(options, project)
    expect(exitCode).toBe(2)
    expect(report.status).toBe('unavailable')
    expect(report.views).toEqual([])
    expect(report.visualQualityAssessed).toBe(false)
    expect(report.remediation).toContain('Windows denied browser process launch')
    expect((await readdir(directory)).sort()).toEqual(['report.json', 'report.md'])
    expect(await readFile(resolve(directory, 'report.md'), 'utf8')).toContain(report.remediation)
    expect(JSON.parse(await readFile(resolve(directory, 'report.json'), 'utf8'))).toEqual(report)
  })

  it.skipIf(!hasPlaywright)('captures three real views and reports bounded defects without claiming a design assessment', async () => {
    const url = await fixture('<!doctype html><title>Review fixture</title><style>body{margin:0}.wide{width:1600px;height:10px}</style><h1>Preview</h1><div class="wide"></div><img src="/missing.png" alt="Example">' + '<button></button>'.repeat(40) + '<script>for(let i=0;i<40;i++)console.error("fixture diagnostic "+i)</script>')
    const { report, directory, exitCode } = await run(`${url}/?token=private`)
    expect(exitCode).toBe(1)
    expect(report.status).toBe('findings')
    expect(report.target).toBe(`${url}/`)
    expect(report.visualQualityAssessed).toBe(false)
    expect(report.views).toHaveLength(3)
    for (const view of report.views) {
      expect(view.dom.horizontalOverflow).toBe(true)
      expect(view.dom.counts.failedImages).toBe(1)
      expect(view.dom.counts.unlabeledControls).toBe(40)
      expect(view.dom.samples.unlabeledControls).toHaveLength(30)
      expect(view.issues).toHaveLength(30)
      expect(view.omittedIssues).toBeGreaterThanOrEqual(10)
      expect(view.screenshot).toBeTruthy()
    }
    expect(report.views[2]?.dom.reducedMotion).toBe(true)
    expect((await readdir(directory)).sort()).toEqual(['desktop.png', 'mobile.png', 'reduced-motion.png', 'report.json', 'report.md'])
    expect(await readFile(resolve(directory, 'report.md'), 'utf8')).toContain('Automated checks do not assess visual quality')
  }, 60000)

  it.skipIf(!hasPlaywright)('prints captured screenshots as a labelled path list for read_image and names who must look', async () => {
    const url = await fixture('<!doctype html><title>Look fixture</title><link rel="icon" href="data:,"><main><h1>Preview</h1></main>')
    const { report, directory, stdout } = await run(url)
    expect(report.status).toBe('checks-complete')
    expect(stdout.screenshots).toHaveLength(3)
    expect(stdout.screenshots.map(entry => entry.name).sort()).toEqual(['desktop', 'mobile', 'reduced-motion'])
    for (const entry of stdout.screenshots) {
      expect(entry.path).toBe(resolve(directory, `${entry.name}.png`))
      expect(existsSync(entry.path)).toBe(true)
    }
    expect(stdout.lookNote).toContain('read_image')
    const markdown = await readFile(resolve(directory, 'report.md'), 'utf8')
    expect(markdown).toContain('## Screenshots to inspect')
    for (const entry of stdout.screenshots) expect(markdown).toContain(entry.path)
    expect(markdown).toContain('This script never looks at pixels itself — an agent must open every screenshot listed below with read_image')
  }, 60000)

  it.skipIf(!hasPlaywright)('waits for the requested visible content before inspecting a hydrated page', async () => {
    const url = await fixture('<!doctype html><html><head><title>Clean fixture</title><link rel="icon" href="data:,"></head><body><script>setTimeout(() => document.body.innerHTML = \'<main><h1>Project</h1><button aria-label="Open menu"><svg><path d="M0 0"></path></svg></button><label for="name">Name</label><input id="name"></main>\', 250)</script></body></html>')
    const { report, exitCode } = await run(url, ['--ready-selector', 'main h1'])
    expect(exitCode).toBe(0)
    expect(report.status).toBe('checks-complete')
    expect(report.visualQualityAssessed).toBe(false)
    expect(report.views.every(view => view.ready === true)).toBe(true)
  }, 60000)

  it.skipIf(!hasPlaywright)('reports an unavailable executable with setup guidance instead of pretending to review', async () => {
    const { report, exitCode } = await run('http://127.0.0.1:1', ['--browser', resolve(tmpdir(), 'saturn-review-nonexistent-browser')])
    expect(exitCode).toBe(2)
    expect(report.status).toBe('unavailable')
    expect(report.views).toEqual([])
    expect(report.remediation).toContain('No installation was attempted')
    expect(report.visualQualityAssessed).toBe(false)
  }, 60000)

  it.skipIf(!hasPlaywright)('reuses explicitly supplied authorized storage state for every viewport without reporting credentials', async () => {
    const out = await mkdtemp(resolve(tmpdir(), 'saturn-review-session-'))
    cleanup.push(() => rm(out, { recursive: true, force: true }))
    const statePath = resolve(out, 'authorized-state.json')
    const cookieValue = 'test-only-authorization-value'
    await writeFile(statePath, JSON.stringify({ cookies: [{ name: 'preview', value: cookieValue, domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] }), { mode: 0o600 })
    const url = await fixture('<!doctype html><title>Authorized preview</title><link rel="icon" href="data:,"><main><h1>Account workspace</h1></main>', `preview=${cookieValue}`)
    const { report, exitCode } = await run(url, ['--storage-state', statePath, '--ready-selector', 'main h1'])
    expect(exitCode).toBe(0)
    expect(report.status).toBe('checks-complete')
    expect(report.views).toHaveLength(3)
    expect(report.views.every(view => view.ready === true)).toBe(true)
    expect(JSON.stringify(report)).not.toContain(cookieValue)
    expect(JSON.stringify(report)).not.toContain('authorized-state.json')
  }, 60000)

  it.skipIf(!hasPlaywright)('does not leak malformed session-state contents through browser parser diagnostics', async () => {
    const out = await mkdtemp(resolve(tmpdir(), 'saturn-review-invalid-session-'))
    cleanup.push(() => rm(out, { recursive: true, force: true }))
    const statePath = resolve(out, 'invalid-state.json')
    await writeFile(statePath, 'sensitive-session-value is not JSON', { mode: 0o600 })
    const { report, exitCode } = await run('http://127.0.0.1:1', ['--storage-state', statePath])
    expect(exitCode).toBe(1)
    expect(report.status).toBe('incomplete')
    expect(JSON.stringify(report)).toContain('readable, valid Playwright storage state file')
    expect(JSON.stringify(report)).not.toContain('sensitive-session-value')
  }, 60000)

  it.skipIf(!hasPlaywright)('captures completed entrance content while leaving an infinite ambient animation running', async () => {
    const url = await fixture(`<!doctype html><title>Animated preview</title><link rel="icon" href="data:,"><style>
      main { animation: entrance 900ms both }
      .ambient { width: 20px; height: 20px; animation: ambience 1s infinite alternate }
      @keyframes entrance { from { opacity: 0 } to { opacity: 1 } }
      @keyframes ambience { from { opacity: .2 } to { opacity: .4 } }
      @media (prefers-reduced-motion: reduce) { main, .ambient { animation: none } }
      </style><main><div class="ambient" aria-hidden="true"></div></main><script>
      const main = document.querySelector('main');
      const complete = () => { main.insertAdjacentHTML('beforeend', '<h1>Settled entrance</h1>'); };
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) complete();
      else main.addEventListener('animationend', event => { if (event.target === main) complete(); }, { once: true });
      </script>`)
    const { report, exitCode } = await run(url, ['--ready-selector', 'main'])
    expect(exitCode).toBe(0)
    expect(report.status).toBe('checks-complete')
    expect(report.views).toHaveLength(3)
    expect(report.views.every(view =>
      view.settling.fontsReady && !view.settling.timedOut && view.settling.unfinishedFiniteAnimations === 0,
    )).toBe(true)
    expect(report.views[2]?.settling.finiteAnimationsObserved).toBe(0)
    expect(report.views[2]?.dom.reducedMotion).toBe(true)
  }, 60000)

  it.skipIf(!hasPlaywright)('reports a bounded settling timeout and still captures an unfinished entrance', async () => {
    const url = await fixture('<!doctype html><title>Slow preview</title><link rel="icon" href="data:,"><style>main{animation:entrance 60s both}@keyframes entrance{from{opacity:.1}to{opacity:1}}</style><main><h1>Slow entrance</h1></main>')
    const { report, exitCode } = await run(url, ['--timeout', '1000'])
    expect(exitCode).toBe(1)
    expect(report.status).toBe('findings')
    expect(report.views).toHaveLength(3)
    expect(report.views.every(view => view.settling.timedOut && view.screenshot !== null && view.issues.some(issue => issue.kind === 'settling-timeout'))).toBe(true)
  }, 60000)
})
