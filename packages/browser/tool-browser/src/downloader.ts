/**
 * Zero-dependency Chromium auto-fetch for a clean install. `playwright-core`
 * ships its own browser installer as a CLI entry point
 * (`playwright-core/cli.js install chromium`); this module shells out to that
 * exact entry point rather than re-implementing a downloader against the
 * Chrome-for-Testing endpoints, so the resolved build always matches the
 * `playwright-core` version this package depends on. No package is added to
 * fetch it — the same install artifact `pnpm exec playwright install
 * chromium` would produce lands in the same `ms-playwright` cache Playwright
 * itself resolves at launch.
 * @module @deepseek-ai/dsh-tool-browser/downloader
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/** The command a deployment can run by hand when the auto-fetch itself cannot. */
export const MANUAL_INSTALL_COMMAND = 'pnpm exec playwright install chromium'

/** One line of installer output, forwarded as-is (already includes a progress percentage when Playwright prints one). */
export type DownloadProgressListener = (line: string) => void

/** Downloads (or verifies) Chromium for the local `playwright-core` version. Swapped for a test double in unit tests. */
export type ChromiumDownloader = (onProgress: DownloadProgressListener, signal?: AbortSignal) => Promise<void>

/**
 * Locate the `playwright-core` CLI script on disk without going through
 * package-export resolution — `cli.js` is not a declared export subpath, but
 * it is the package's own `bin` target, so joining it onto the resolved
 * package directory is the supported access pattern for a script Node itself
 * is about to execute directly.
 * @returns the absolute path to `playwright-core`'s `cli.js`.
 * @throws when `playwright-core` cannot be resolved from this module.
 */
export function resolvePlaywrightCliPath(): string {
  const require = createRequire(import.meta.url)
  let packageJsonPath: string
  try {
    packageJsonPath = require.resolve('playwright-core/package.json')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`browser: could not locate playwright-core to download Chromium (${detail})`)
  }
  return join(dirname(packageJsonPath), 'cli.js')
}

/**
 * Split a chunk of child-process output into complete, non-empty lines.
 * @param chunk - raw stdout/stderr bytes.
 * @returns the chunk's lines, dropping a trailing empty fragment.
 */
export function splitProgressLines(chunk: string): string[] {
  return chunk.split(/\r?\n/u).filter(line => line.trim().length > 0)
}

/**
 * Download (or verify) the Chromium build `playwright-core` expects by
 * running its bundled installer as a child process, forwarding every output
 * line to `onProgress` as it arrives so a caller can surface live download
 * percentages. $0: no new dependency, and the installer skips the download
 * entirely when the exact build is already cached.
 * @param onProgress - called once per installer output line, in order.
 * @param signal - when aborted, the child process is killed and the returned
 *   promise rejects.
 * @throws with {@link MANUAL_INSTALL_COMMAND} in the message when the CLI
 *   cannot be located, cannot be started, or exits non-zero.
 */
export const downloadChromium: ChromiumDownloader = async (onProgress, signal) => {
  const cliPath = resolvePlaywrightCliPath()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, 'install', 'chromium'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let settled = false
    const forward = (chunk: Buffer): void => {
      for (const line of splitProgressLines(chunk.toString('utf8'))) onProgress(line)
    }
    child.stdout?.on('data', forward)
    child.stderr?.on('data', forward)
    const onAbort = (): void => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error('browser: Chromium download aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const cleanup = (): void => {
      signal?.removeEventListener('abort', onAbort)
    }
    child.on('error', (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(
        `browser: failed to start the Chromium downloader (${error.message}). `
        + `Install it yourself with \`${MANUAL_INSTALL_COMMAND}\`.`,
      ))
    })
    child.on('exit', (code) => {
      if (settled) return
      settled = true
      cleanup()
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(
        `browser: Chromium download failed (installer exited with code ${code ?? 'null'}). `
        + `Install it yourself with \`${MANUAL_INSTALL_COMMAND}\`.`,
      ))
    })
  })
}
