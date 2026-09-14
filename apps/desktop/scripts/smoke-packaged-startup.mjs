/** Boot the packaged main module and renderer with a private Harness home. */

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

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
  const completed = spawnSync(executable, [], { env: environment, stdio: 'inherit', timeout: 90_000 })
  const detail = existsSync(resultPath) ? readFileSync(resultPath, 'utf8') : 'no result file'
  if (completed.error !== undefined) throw new Error(`packaged startup failed: ${detail}`, { cause: completed.error })
  if (completed.signal !== null) throw new Error(`packaged startup terminated by ${completed.signal}: ${detail}`)
  if (completed.status !== 0) throw new Error(`packaged startup exited ${completed.status}: ${detail}`)
  if (!existsSync(resultPath) || JSON.parse(detail).ok !== true) throw new Error(`packaged startup failed: ${detail}`)
  console.log(`Packaged desktop startup passed: ${detail.trim()}`)
} finally {
  writeFileSync(manifestPath, originalManifest)
  rmSync(fixture, { force: true })
  rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
