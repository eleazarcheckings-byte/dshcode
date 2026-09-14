/**
 * Browser-safe path helpers for actions that hand a path back to the Host OS.
 *
 * The reveal flow never invents a path: a card that shows a truncated label
 * still carries the operator's real filesystem path, and clearing that path to
 * its containing directory is what lets "open in folder" work without a second
 * OS-integration mechanism. Everything here is pure string work so it can run
 * in the renderer, the plugin bundles, and the test suite identically.
 */

/** Whether a path uses a Windows drive spelling (`C:\…`, `C:/…`) or a UNC prefix. */
function isWindowsStylePath(value: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\')
}

/**
 * Split a path into its non-empty segments, keeping the Windows prefix intact.
 * @param path - absolute or relative path in either separator spelling.
 * @returns the path's segments, prefix first (`C:` / `\\server\share` count as prefix segments).
 */
function segmentsOf(path: string): { readonly prefix: string; readonly rest: readonly string[] } {
  if (isWindowsStylePath(path)) {
    if (path.startsWith('\\\\')) {
      // UNC: `\\server\share\a\b` — the share is the root, so it is prefix.
      const [server, share, ...rest] = path.slice(2).split(/[/\\]+/).filter(segment => segment !== '')
      const root = share === undefined ? `\\\\${server ?? ''}` : `\\\\${server ?? ''}\\${share}`
      return { prefix: root, rest }
    }
    const [drive, ...rest] = path.split(/[/\\]+/).filter(segment => segment !== '')
    return { prefix: drive ?? '', rest }
  }
  const rest = path.split('/').filter(segment => segment !== '')
  return { prefix: path.startsWith('/') ? '/' : '', rest }
}

/** Join a Windows prefix and segments with backslashes; the prefix already carries its own tail. */
function joinWindows(prefix: string, segments: readonly string[]): string {
  if (segments.length === 0) return `${prefix}\\`
  return `${prefix}\\${segments.join('\\')}`
}

/**
 * The containing directory of a filesystem path, in the path's own separator
 * spelling.
 *
 * Returns `undefined` when there is no container to open — a bare file name
 * carries no directory, and a filesystem root (`/`, `C:\`, `\\server\share`)
 * has nothing above it. Callers treat `undefined` as "the reveal row does not
 * apply here" rather than substituting a guess, so a root-level path can never
 * open an unrelated folder.
 * @param path - a path the operator's cards already show.
 * @returns the parent directory, or undefined at a root or for a bare name.
 */
export function parentDirectory(path: string): string | undefined {
  const trimmed = path.replace(/[/\\]+$/, '')
  const { prefix, rest } = segmentsOf(trimmed)
  if (rest.length === 0) return undefined
  const parentSegments = rest.slice(0, -1)
  if (parentSegments.length === 0) return undefined
  if (isWindowsStylePath(trimmed)) return joinWindows(prefix, parentSegments)
  if (prefix === '/') return `/${parentSegments.join('/')}`
  return parentSegments.join('/')
}
