/** Browser evidence for a running preview; screenshots require human or agent visual review. */
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const HELP = `Usage: node review-web.mjs --url http://127.0.0.1:3000 --out ./artifacts [--ready-selector "main h1"] [--storage-state ./authorized-preview-state.json] [--browser /path/to/chromium] [--allow-remote] [--timeout 15000]
Run from the target project's directory. Uses its installed playwright or @playwright/test, then the skill's installation. Never installs dependencies or browsers.
--storage-state reuses only the explicitly supplied Playwright session state in each viewport. Session state is never discovered automatically or copied into the report.
Produces desktop, mobile, and reduced-motion viewport screenshots plus report.json and report.md in a new review-* subdirectory.
Before capture, waits within --timeout for fonts and finite running entrance animations; infinite or paused animations keep their current state.
Each view also reports "measure": the median rendered characters-per-line over the first 20 lines
of the main prose container ({measure_ch, pass: <= 75}), or null when no sampleable prose is found.
Pass this report.json to review-grade.mjs's --report to grade rendered line length there.
Exit codes: 0 checks completed without findings; 1 findings or incomplete review; 2 unavailable browser/dependency or invalid arguments. Visual quality is not assessed.`
const VIEWS = [
  { name: 'desktop', width: 1440, height: 1000, reducedMotion: 'no-preference' },
  { name: 'mobile', width: 390, height: 844, reducedMotion: 'no-preference' },
  { name: 'reduced-motion', width: 1440, height: 1000, reducedMotion: 'reduce' },
]
const MAX_ITEMS = 30
const MAX_TEXT = 300

/** Permit HTTP previews; remote origins require the caller's explicit flag.
 * @param {string} value URL to inspect.
 * @param {boolean} allowRemote Whether remote preview navigation is authorized.
 * @returns {boolean} Whether the URL is permitted.
 */
export function isAllowedUrl(value, allowRemote = false) {
  let url
  try { url = new URL(value) } catch { return false }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false
  return allowRemote || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
}

/** Parse bounded CLI input without touching the browser or filesystem.
 * @param {string[]} argv CLI arguments without the Node executable and script.
 * @returns {{help: boolean, url?: string, out?: string, browser?: string, readySelector?: string, storageState?: string, allowRemote: boolean, timeout: number}} Parsed options.
 */
export function parseArgs(argv) {
  if (argv.length > 16 || argv.some(value => value.length > 4096 || value.includes('\0'))) throw new Error('Arguments exceed supported limits.')
  const values = new Map()
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (!['--help', '--url', '--out', '--browser', '--ready-selector', '--storage-state', '--allow-remote', '--timeout'].includes(flag)) throw new Error(`Unknown argument: ${flag.slice(0, 60)}`)
    if (values.has(flag)) throw new Error(`Repeated argument: ${flag}`)
    if (flag === '--help' || flag === '--allow-remote') values.set(flag, true)
    else {
      const value = argv[++index]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
      values.set(flag, value)
    }
  }
  const allowRemote = values.has('--allow-remote')
  if (values.has('--help')) return { help: true, allowRemote, timeout: 15000 }
  const url = values.get('--url')
  if (!url || !isAllowedUrl(url, allowRemote)) throw new Error('--url must be an HTTP(S) loopback URL without credentials. Use --allow-remote only for an authorized remote preview.')
  if (!values.get('--out')) throw new Error('--out is required.')
  const timeout = Number(values.get('--timeout') ?? 15000)
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 30000) throw new Error('--timeout must be an integer from 1000 to 30000 milliseconds per operation.')
  const readySelector = values.get('--ready-selector')
  if (readySelector && readySelector.length > 512) throw new Error('--ready-selector must contain at most 512 characters.')
  return { help: false, url: new URL(url).href, out: resolve(values.get('--out')), browser: values.get('--browser') ? resolve(values.get('--browser')) : undefined, readySelector, storageState: values.get('--storage-state') ? resolve(values.get('--storage-state')) : undefined, allowRemote, timeout }
}

function safeUrl(value) {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`.slice(0, MAX_TEXT)
  } catch { return '[unavailable URL]' }
}

/** Bound diagnostics and remove credentials/query values from embedded URLs.
 * @param {unknown} value Browser diagnostic.
 * @returns {string} Single-line bounded diagnostic.
 */
export function diagnosticText(value) {
  return String(value).replace(/https?:\/\/[^\s"'<>]+/g, safeUrl).replace(/[\r\n\t]+/g, ' ').slice(0, MAX_TEXT)
}

/** Explain a failure before browser creation without changing execution policy.
 * @param {string} message Original launch/dependency error, before diagnostic clipping.
 * @param {string} platform Operating system where the launch failed.
 * @returns {string} Recovery guidance; EPERM identifies a denial, not its exact policy source.
 */
export function launchRemediation(message, platform = process.platform) {
  if (platform === 'win32' && /\bspawn EPERM\b/.test(message)) {
    return 'Browser review is unavailable; no screenshots were captured. Windows denied browser process launch (spawn EPERM). Restricted Windows processes can block the pipes Playwright requires even with a browser installed. Use an authorized browser integration or operator-supported browser execution that preserves shell policy. Do not automatically disable the sandbox. No installation or policy change was attempted.'
  }
  return 'No screenshots were captured. Use an installed Chromium browser with --browser, or configure Playwright in the target project using its documented setup. No installation was attempted.'
}

function resolveChromium(cwd) {
  const resolvers = [createRequire(pathToFileURL(resolve(cwd, 'package.json'))), createRequire(import.meta.url)]
  for (const resolver of resolvers) {
    for (const name of ['playwright', '@playwright/test']) {
      let modulePath
      try { modulePath = resolver.resolve(name) } catch (error) {
        if (error.code === 'MODULE_NOT_FOUND') continue
        throw error
      }
      const loaded = resolver(modulePath)
      if (loaded.chromium) return loaded.chromium
    }
  }
  throw new Error('Playwright is unavailable. Install playwright or @playwright/test in the target project, supply its Chromium browser installation, then rerun from that project directory. No installation was attempted.')
}

function browserEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH|COOKIE/i.test(name)))
}

// Runs in the page. Returned text excludes input values and full HTML.
function inspectPage() {
  const cap = 30
  const text = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const visible = element => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && !element.closest('[hidden],[inert],[aria-hidden="true"]')
  }
  const label = element => {
    const refs = (element.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
    const referenceText = refs.map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim()
    const imageText = [...element.querySelectorAll('img[alt],svg title')].map(child => child.getAttribute('alt') ?? child.textContent ?? '').join(' ').trim()
    const nativeLabels = element.labels ? [...element.labels].map(item => item.textContent ?? '').join(' ').trim() : ''
    const nativeButton = element instanceof HTMLInputElement && ['submit', 'reset', 'button'].includes(element.type)
    return text(element.getAttribute('aria-label') || referenceText || nativeLabels || element.getAttribute('title') || (nativeButton ? element.value || (element.type === 'submit' ? 'Submit' : element.type === 'reset' ? 'Reset' : '') : '') || text(element.textContent) || imageText)
  }
  const counts = { overflow: 0, failedImages: 0, unlabeledControls: 0 }
  const samples = { overflow: [], failedImages: [], unlabeledControls: [] }
  const all = document.querySelectorAll('body *')
  const scanLimit = Math.min(all.length, 10000)
  for (let index = 0; index < scanLimit; index++) {
    const element = all[index]
    if (!visible(element)) continue
    const rect = element.getBoundingClientRect()
    const elementName = `${element.tagName.toLowerCase()}${element.id ? `#${text(element.id)}` : ''}`
    if (rect.right > innerWidth + 1 || rect.left < -1) {
      counts.overflow++
      if (samples.overflow.length < cap) samples.overflow.push(elementName)
    }
    if (element instanceof HTMLImageElement && element.complete && element.naturalWidth === 0 && (element.currentSrc || element.src)) {
      counts.failedImages++
      if (samples.failedImages.length < cap) samples.failedImages.push(elementName)
    }
    if (element.matches('button,a[href],input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[role="textbox"],[role="combobox"]') && !label(element)) {
      counts.unlabeledControls++
      if (samples.unlabeledControls.length < cap) samples.unlabeledControls.push(elementName)
    }
  }
  const mains = [...document.querySelectorAll('main,[role="main"]')].filter(visible).length
  const h1 = [...document.querySelectorAll('h1,[role="heading"][aria-level="1"]')].filter(visible).length
  return { viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1, mains, h1, counts, samples, scannedElements: scanLimit, omittedElements: Math.max(0, all.length - scanLimit), reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches }
}

// Runs in the page. jsdom (review-grade.mjs's static probe) has no layout engine and can never
// see this: the real per-character line-wrap geometry a live browser renders. Segments the main
// prose container's visible <p>/<li> text into wrapped lines by growing a single-character Range
// per character and watching `getClientRects()[0].top` change, then reports the median characters
// per line over the first MEASURE_LINE_TARGET lines sampled (not the first N elements — a short
// paragraph contributes fewer lines, a long one more, up to the cap). Bounded by MEASURE_CHAR_CAP
// so a very long page cannot make this scan unbounded. Returns null when no visible prose text is
// found to sample, never a guessed value.
function measureProse() {
  const MEASURE_LINE_TARGET = 20
  const MEASURE_CHAR_CAP = 4000
  const container = document.querySelector('main') || document.body
  const blocks = [...container.querySelectorAll('p, li')].filter((el) => {
    const style = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && (el.textContent || '').trim().length > 0
  })
  const lineLengths = []
  let scanned = 0
  for (const block of blocks) {
    if (lineLengths.length >= MEASURE_LINE_TARGET) break
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
    let currentTop = null
    let currentLength = 0
    let node
    while ((node = walker.nextNode())) {
      const text = node.textContent || ''
      for (let index = 0; index < text.length; index++) {
        if (scanned >= MEASURE_CHAR_CAP || lineLengths.length >= MEASURE_LINE_TARGET) break
        scanned++
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + 1)
        const rects = range.getClientRects()
        const top = rects.length ? Math.round(rects[0].top) : currentTop
        if (currentTop === null) currentTop = top
        if (top !== currentTop) {
          lineLengths.push(currentLength)
          currentTop = top
          currentLength = 1
        } else currentLength++
      }
      if (scanned >= MEASURE_CHAR_CAP || lineLengths.length >= MEASURE_LINE_TARGET) break
    }
    if (currentLength > 0 && lineLengths.length < MEASURE_LINE_TARGET) lineLengths.push(currentLength)
  }
  if (!lineLengths.length) return null
  const sorted = [...lineLengths].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  return { measure_ch: Math.round(median * 10) / 10, pass: median <= 75, linesSampled: lineLengths.length }
}

// Runs in the page. Await actual completion without stopping ambient loops or changing motion preferences.
async function settlePage(timeout) {
  const deadline = performance.now() + timeout
  const observed = new Set()
  const activeFiniteAnimations = () => document.getAnimations().filter(animation =>
    (animation.playState === 'running' || animation.pending) && animation.playbackRate !== 0 && Number.isFinite(animation.effect?.getComputedTiming().endTime),
  )
  const wait = async (promise) => {
    const remaining = deadline - performance.now()
    if (remaining <= 0) return false
    let timer
    try {
      return await Promise.race([
        promise.then(() => true, () => true),
        new Promise(resolveWait => { timer = setTimeout(() => resolveWait(false), remaining) }),
      ])
    } finally { clearTimeout(timer) }
  }
  const fontsReady = await wait(document.fonts.ready)
  let timedOut = !fontsReady
  let animationLimitReached = false
  while (!timedOut) {
    const active = activeFiniteAnimations()
    if (active.length === 0) break
    for (const animation of active) {
      if (observed.size === 1000 && !observed.has(animation)) { animationLimitReached = true; break }
      observed.add(animation)
    }
    if (animationLimitReached) break
    timedOut = !await wait(Promise.all(active.map(animation => animation.finished.catch(() => { /* Canceled transitions have already settled. */ }))))
  }
  return { fontsReady, finiteAnimationsObserved: Math.min(observed.size, 1000), unfinishedFiniteAnimations: Math.min(activeFiniteAnimations().length, 1000), timedOut, animationLimitReached }
}

async function captureView(browser, options, view, directory) {
  let context
  try {
    context = await browser.newContext({ viewport: { width: view.width, height: view.height }, reducedMotion: view.reducedMotion, deviceScaleFactor: 1, serviceWorkers: 'block', storageState: options.storageState })
  } catch (error) {
    // Playwright JSON parser errors can include supplied session-state contents.
    if (options.storageState) throw new Error('Browser context could not load the supplied session state. Verify that --storage-state names a readable, valid Playwright storage state file.')
    throw error
  }
  try {
    const page = await context.newPage()
    page.setDefaultTimeout(options.timeout)
    page.setDefaultNavigationTimeout(options.timeout)
    const issues = []
    let omittedIssues = 0
    const issue = (kind, detail) => {
      if (issues.length < MAX_ITEMS) issues.push({ kind, detail: diagnosticText(detail) })
      else omittedIssues++
    }
    page.on('console', message => { if (message.type() === 'error') issue('console-error', message.text()) })
    page.on('pageerror', error => issue('page-error', error.message))
    page.on('dialog', dialog => { issue('dialog', `Unexpected ${dialog.type()} dialog dismissed.`); void dialog.dismiss().catch(() => { /* Page teardown may already have dismissed it. */ }) })
    page.on('popup', popup => { issue('popup', 'Unexpected popup closed.'); void popup.close().catch(() => { /* Context teardown may already have closed it. */ }) })
    await page.route('**/*', async route => {
      const request = route.request()
      if (request.isNavigationRequest() && request.frame() === page.mainFrame() && !isAllowedUrl(request.url(), options.allowRemote)) {
        issue('blocked-navigation', safeUrl(request.url()))
        await route.abort('blockedbyclient')
      } else await route.continue()
    })
    let navigationStatus = null
    try {
      const response = await page.goto(options.url, { waitUntil: 'load' })
      navigationStatus = response?.status() ?? null
      if (navigationStatus !== null && navigationStatus >= 400) issue('http-error', `Preview returned HTTP ${navigationStatus}.`)
    } catch (error) { issue('navigation-error', error.message) }
    let ready = options.readySelector ? false : null
    if (options.readySelector) {
      try {
        await page.locator(`css=${options.readySelector}`).first().waitFor({ state: 'visible', timeout: options.timeout })
        ready = true
      } catch (error) { issue('readiness-error', error.message) }
    }
    const screenshot = `${view.name}.png`
    let dom = null
    let measure = null
    let settling = null
    try {
      settling = await page.evaluate(settlePage, options.timeout)
      if (settling.timedOut) issue('settling-timeout', 'Fonts or finite entrance animations did not finish within the capture timeout; inspect this screenshot as an unsettled state.')
      if (settling.animationLimitReached) issue('settling-limit', 'More than 1000 finite animations were observed; capture stopped waiting and may show an unsettled state.')
      await page.screenshot({ path: resolve(directory, screenshot), fullPage: false, timeout: options.timeout })
      dom = await page.evaluate(inspectPage)
      // Rendered character-measure: jsdom (review-grade.mjs) has no layout engine and cannot see
      // this, so it is captured here instead, from real per-view geometry, and read back by
      // review-grade.mjs's --report flag. null (no sampleable prose) is reported as-is, never guessed.
      measure = await page.evaluate(measureProse)
    } catch (error) { issue('inspection-error', error.message) }
    return { name: view.name, viewport: { width: view.width, height: view.height }, url: safeUrl(page.url()), navigationStatus, ready, settling, screenshot: dom ? screenshot : null, dom, measure, issues, omittedIssues }
  } finally { await context.close() }
}

function hasFindings(view) {
  return !view.dom || view.issues.length > 0 || view.dom.horizontalOverflow || view.dom.counts.failedImages > 0 || view.dom.counts.unlabeledControls > 0 || view.dom.mains !== 1 || view.dom.h1 !== 1 || view.dom.omittedElements > 0
}

function markdown(report) {
  const lines = ['# Browser review evidence', '', `Status: **${report.status}**`, '', 'Automated checks do not assess visual quality, brand fit, contrast, animation quality, full accessibility, or user journeys. Inspect every screenshot and test the important interactions before calling the work complete.', '', `Target: ${report.target}`, '']
  if (report.error) lines.push(`Unavailable: ${report.error}`, '')
  if (report.remediation) lines.push(report.remediation, '')
  for (const view of report.views) {
    lines.push(`## ${view.name}`, '')
    if (view.screenshot) lines.push(`![${view.name}](${view.screenshot})`, '')
    if (view.dom) lines.push(`Horizontal overflow: ${view.dom.horizontalOverflow}. Failed images: ${view.dom.counts.failedImages}. Potential unlabeled controls: ${view.dom.counts.unlabeledControls}. Main landmarks: ${view.dom.mains}. Level-one headings: ${view.dom.h1}.`, '')
    lines.push(view.measure ? `Rendered character measure: ${view.measure.measure_ch}ch median over ${view.measure.linesSampled} sampled line(s) (${view.measure.pass ? 'within' : 'over'} the 75ch budget).` : 'Rendered character measure: no sampleable prose found in the main container.', '')
    for (const issue of view.issues) lines.push(`- ${issue.kind}: ${issue.detail.replace(/[<>]/g, '')}`)
    if (view.omittedIssues) lines.push(`- ${view.omittedIssues} additional diagnostics omitted.`)
    lines.push('')
  }
  lines.push('## Scope', '', 'Three fresh browser contexts capture initial-page viewports after the load event and, when specified, a visible --ready-selector. Capture awaits fonts and finite running CSS/Web Animations within one --timeout window, observes at most 1000 finite animations, and reports any settling timeout. Infinite, paused, and zero-playback-rate animations remain untouched. Script-driven canvas animation is not paused or assessed. Each context reuses the same authorized session state only when --storage-state is supplied; state contents are not included in the report. The reduced-motion image records the requested preference; it does not prove all animation stops. DOM checks scan at most 10,000 elements and include at most 30 samples per category. Console/page errors include at most 30 bounded entries per viewport. Potential unlabeled controls use a heuristic, not a full accessibility-name implementation. Clipped carousels can appear among overflow samples. No interaction, login, form submission, source changes, or browser installation is performed.', '')
  return lines.join('\n')
}

/** Capture isolated preview evidence and close all browser contexts before returning.
 * @param {ReturnType<typeof parseArgs>} options Parsed CLI options.
 * @param {string} cwd Target project directory used for Playwright resolution.
 * @returns {Promise<{directory: string, report: object, exitCode: number}>} Artifact directory, structured report, and process exit code.
 */
export async function runReview(options, cwd = process.cwd()) {
  if (options.help || !options.url || !options.out) throw new Error('Review requires parsed --url and --out options.')
  await mkdir(options.out, { recursive: true })
  const directory = await mkdtemp(resolve(options.out, 'review-'))
  const report = { version: 1, target: safeUrl(options.url), visualQualityAssessed: false, status: 'unavailable', views: [] }
  let browser
  let deadline
  let timedOut = false
  try {
    const chromium = resolveChromium(cwd)
    browser = await chromium.launch({ headless: true, executablePath: options.browser, timeout: options.timeout, env: browserEnvironment() })
    deadline = setTimeout(() => {
      timedOut = true
      void browser.close().catch(() => { /* The ordinary teardown may have closed the browser already. */ })
    }, options.timeout * 6)
    deadline.unref()
    for (const view of VIEWS) report.views.push(await captureView(browser, options, view, directory))
    report.status = report.views.some(hasFindings) ? 'findings' : 'checks-complete'
  } catch (error) {
    report.error = timedOut ? 'Review deadline exceeded; the browser was closed.' : diagnosticText(error.message)
    if (!browser) report.remediation = launchRemediation(error.message)
    if (browser) report.status = 'incomplete'
  } finally {
    clearTimeout(deadline)
    if (browser) await browser.close()
  }
  await writeFile(resolve(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  await writeFile(resolve(directory, 'report.md'), markdown(report), { flag: 'wx', mode: 0o600 })
  return { directory, report, exitCode: report.status === 'checks-complete' ? 0 : report.status === 'unavailable' ? 2 : 1 }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) process.stdout.write(`${HELP}\n`)
    else {
      const result = await runReview(options)
      process.stdout.write(`${JSON.stringify({ status: result.report.status, directory: result.directory, report: resolve(result.directory, 'report.json'), visualQualityAssessed: false })}\n`)
      process.exitCode = result.exitCode
    }
  } catch (error) {
    process.stderr.write(`${diagnosticText(error.message)}\n${HELP}\n`)
    process.exitCode = 2
  }
}
