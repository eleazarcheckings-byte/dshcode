/** Boot the packaged main module and renderer with a private Harness home. */

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const comparable = path => process.platform === 'win32' ? path.toLowerCase() : path

/** Remove only one smoke-owned temporary directory, unlinking profile junctions without visiting targets.
 * @param {string} directory The root returned by this smoke's mkdtempSync call.
 * @returns {void} Returns after the tree is removed; failures remain visible to the caller.
 */
export function removeSmokeScratch(directory) {
  const root = resolve(directory)
  const parent = realpathSync(tmpdir())
  if (comparable(realpathSync(dirname(root))) !== comparable(parent) || !/^saturn-ai-startup-[A-Za-z0-9]+$/.test(basename(root))) {
    throw new Error('Refusing cleanup outside a smoke-owned temporary root.')
  }
  let rootStat
  try { rootStat = lstatSync(root) } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('Refusing cleanup of a link or non-directory smoke root.')
  const canonicalRoot = realpathSync(root)
  function unlinkProfileLinks(path) {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) {
      unlinkSync(path)
    } else if (stat.isDirectory()) {
      const canonical = realpathSync(path)
      if (comparable(canonical) !== comparable(canonicalRoot) && !comparable(canonical).startsWith(comparable(canonicalRoot + sep))) {
        throw new Error('Refusing cleanup outside the verified smoke root.')
      }
      for (const entry of readdirSync(path)) unlinkProfileLinks(join(path, entry))
    }
  }
  unlinkProfileLinks(root)
  // No link-shaped entries remain; Windows rmSync otherwise fails on profile junctions.
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}

/** Remove URL credentials, queries, and fragments from captured startup diagnostics.
 * @param {string} output Child output or smoke result text.
 * @returns {string} Diagnostics without single-use preview URL tokens.
 */
export function redactSmokeOutput(output) {
  return output.replace(/https?:\/\/[^\s"'<>]+/g, (value) => {
    try { const url = new URL(value); return `${url.origin}${url.pathname}` } catch { return '[redacted URL]' }
  })
}

/** Boot the prepared package, restore its manifest, and clean its private profile before reporting success.
 * @returns {void} Returns only after launch evidence and cleanup pass; launch errors are never replaced by cleanup errors.
 */
export function runPackagedStartupSmoke() {
  const appRoot = resolve(import.meta.dirname, '..')
  const releaseRoot = resolve(appRoot, '../../.artifacts/desktop/release')
  const bundle = process.platform === 'win32'
    ? join(releaseRoot, 'win-unpacked')
    : join(releaseRoot, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Saturn AI.app', 'Contents')
  const executable = join(bundle, process.platform === 'win32' ? 'Saturn AI.exe' : 'MacOS/Saturn AI')
  const resources = join(bundle, process.platform === 'win32' ? 'resources/app' : 'Resources/app')
  const manifestPath = join(resources, 'package.json')
  const fixture = join(resources, 'packaged-startup-smoke.mjs')
  const originalManifest = readFileSync(manifestPath, 'utf8')
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'saturn-ai-startup-'))
  const resultPath = join(temporaryRoot, 'result.json')
  const failures = []
  let detail = 'no result file'
  try {
    const manifest = JSON.parse(originalManifest)
    const main = manifest.main
    manifest.main = 'packaged-startup-smoke.mjs'
    copyFileSync(join(appRoot, 'tests/fixtures/packaged-startup-smoke.mjs'), fixture)
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const environment = {
      ...process.env,
      DSH_HOME: join(temporaryRoot, 'harness'),
      DSH_TELEMETRY_DISABLED: '1',
      DSHCODE_STARTUP_SMOKE_ROOT: temporaryRoot,
      DSHCODE_STARTUP_SMOKE_MAIN: main,
    }
    delete environment.ELECTRON_RUN_AS_NODE
    delete environment.DEEPSEEK_API_KEY
    const completed = spawnSync(executable, [], { env: environment, encoding: 'utf8', stdio: 'pipe', timeout: 90_000, maxBuffer: 1024 * 1024 })
    if (completed.stdout) process.stdout.write(redactSmokeOutput(completed.stdout))
    if (completed.stderr) process.stderr.write(redactSmokeOutput(completed.stderr))
    detail = existsSync(resultPath) ? redactSmokeOutput(readFileSync(resultPath, 'utf8')) : 'no result file'
    if (completed.error !== undefined) throw new Error(`packaged startup failed: ${detail}`, { cause: completed.error })
    if (completed.signal !== null) throw new Error(`packaged startup terminated by ${completed.signal}: ${detail}`)
    if (completed.status !== 0) throw new Error(`packaged startup exited ${completed.status}: ${detail}`)
    if (!existsSync(resultPath) || JSON.parse(detail).ok !== true) throw new Error(`packaged startup failed: ${detail}`)
  } catch (error) { failures.push(error) }
  for (const restore of [
    () => writeFileSync(manifestPath, originalManifest),
    () => rmSync(fixture, { force: true }),
    () => removeSmokeScratch(temporaryRoot),
  ]) {
    try { restore() } catch (error) { failures.push(error) }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Packaged startup or cleanup failed.', { cause: failures[0] })
  console.log(`Packaged desktop startup passed: ${detail.trim()}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runPackagedStartupSmoke()
