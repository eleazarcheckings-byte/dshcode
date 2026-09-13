/** Run the picker bindings with real koffi string decoding inside Electron's Node runtime. */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import electron from 'electron'

const require = createRequire(import.meta.url)
const completed = spawnSync(electron, [
  resolve(require.resolve('vitest/package.json'), '../vitest.mjs'),
  'run',
  'packages/host/directory-picker-native/tests/win32-dialog-bindings.spec.ts',
  '--maxWorkers=1',
], {
  cwd: resolve(import.meta.dirname, '../../..'),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSHCODE_ELECTRON_PICKER_TEST: '1' },
  stdio: 'inherit',
  timeout: 120_000,
})
if (completed.error !== undefined) throw completed.error
if (completed.signal !== null) throw new Error(`Electron picker tests terminated by ${completed.signal}`)
process.exitCode = completed.status ?? 1
