/** Copy for the desktop shell's About surface, independent of Electron globals. */

/**
 * Runtime versions the About surface reports, read from the running process
 * so the surface names the stack the build actually shipped with rather than
 * a version written into the source.
 */
export interface AboutRuntimeVersions {
  electron: string
  chrome: string
  node: string
}

/**
 * The attribution line every About surface carries. The desktop shell and the
 * Harness web UI are forks of two MIT-licensed codebases, and the packager
 * copies their copyright notices into the installed app's `licenses/`
 * directory (`scripts/prepare-package.mjs`), so the About surface names that
 * directory rather than restating the notices.
 */
const ATTRIBUTION = 'MIT licensed. Forked from DSHCode and the DeepSeek Harness web UI; upstream copyright notices ship in licenses/.'

/**
 * Compose the About surface's headline and body. The ring glyph that heads
 * the surface is supplied separately as the dialog's icon, so this function
 * stays pure and runs in tests without Electron.
 * @param productName - the application product name.
 * @param version - the packaged application version.
 * @param runtime - the Electron, Chromium, and Node versions of the running process.
 * @returns the `message` and `detail` fields of the About message box.
 */
export function aboutSurface(
  productName: string,
  version: string,
  runtime: AboutRuntimeVersions,
): { message: string; detail: string } {
  return {
    message: productName,
    detail: [
      `Version ${version}`,
      `Electron ${runtime.electron} \u00b7 Chromium ${runtime.chrome} \u00b7 Node ${runtime.node}`,
      '',
      ATTRIBUTION,
    ].join('\n'),
  }
}
