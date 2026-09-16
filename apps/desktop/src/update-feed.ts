/**
 * electron-updater GitHub-provider feed for this product. The channel is
 * pinned to eleazarcheckings-byte/dshcode; a third-party owner is refused
 * rather than followed. Checking is user-initiated. A missing latest.yml is
 * reported as an empty feed, not as "you are up to date."
 */

/** GitHub owner that publishes Saturn AI desktop artifacts. */
export const UPDATE_OWNER = 'eleazarcheckings-byte'

/** GitHub repository that publishes Saturn AI desktop artifacts. */
export const UPDATE_REPO = 'dshcode'

/** Upstream / third-party owner that must never become the update channel. */
export const FORBIDDEN_UPDATE_OWNER = 'whitelonng'

/** The only update channel this shell will query. */
export interface UpdateChannel {
  /** GitHub owner. */
  readonly owner: string
  /** GitHub repository. */
  readonly repo: string
}

/** Result of one user-initiated update check. */
export type UpdateCheck =
  | { readonly status: 'current'; readonly current: string; readonly feed: boolean }
  | { readonly status: 'available'; readonly current: string; readonly latest: string; readonly releaseUrl: string }
  | { readonly status: 'available-no-feed'; readonly current: string; readonly latest: string; readonly releaseUrl: string }
  | { readonly status: 'empty'; readonly current: string }
  | { readonly status: 'error'; readonly current: string; readonly message: string }

/** One GitHub Releases API latest-release payload, as this checker reads it. */
export interface GithubLatestRelease {
  /** Tag name (`v1.2.3` or `desktop-v1.2.3`). */
  readonly tag_name: string
  /** HTML URL of the release page. */
  readonly html_url: string
}

const SATURN_RELEASE_HOST = 'github.com'
const SATURN_RELEASE_PREFIX = `/${UPDATE_OWNER}/${UPDATE_REPO}/`

/**
 * The pinned update channel. Throws when the caller tries to retarget it at
 * a third-party owner.
 * @param channel - owner/repo pair, defaulting to the Saturn AI fork.
 * @returns the same channel after the owner check.
 */
export function pinnedUpdateChannel(channel: UpdateChannel = {
  owner: UPDATE_OWNER,
  repo: UPDATE_REPO,
}): UpdateChannel {
  if (channel.owner === FORBIDDEN_UPDATE_OWNER) {
    throw new Error('update feed refuses third-party owner whitelonng/dshcode')
  }
  if (channel.owner !== UPDATE_OWNER || channel.repo !== UPDATE_REPO) {
    throw new Error(`update feed refuses channel ${channel.owner}/${channel.repo}`)
  }
  return channel
}

/**
 * electron-updater GitHub-provider latest.yml URL for this platform.
 * @param platform - process.platform of the running install.
 * @param channel - owner/repo pair, defaulting to the Saturn AI fork.
 * @returns the HTTPS URL of the YAML feed.
 */
export function updateFeedUrl(
  platform: NodeJS.Platform,
  channel?: UpdateChannel,
): string {
  const { owner, repo } = pinnedUpdateChannel(channel)
  const file = platform === 'darwin'
    ? 'latest-mac.yml'
    : platform === 'linux'
      ? 'latest-linux.yml'
      : 'latest.yml'
  return `https://github.com/${owner}/${repo}/releases/latest/download/${file}`
}

/**
 * GitHub Releases API URL for the latest non-prerelease.
 * @param channel - owner/repo pair, defaulting to the Saturn AI fork.
 * @returns the HTTPS API URL.
 */
export function githubLatestApiUrl(channel?: UpdateChannel): string {
  const { owner, repo } = pinnedUpdateChannel(channel)
  return `https://api.github.com/repos/${owner}/${repo}/releases/latest`
}

/**
 * Parse a committed or generated `app-update.yml` and refuse a third-party owner.
 * @param text - YAML body.
 * @returns the channel named by the file.
 */
export function parseAppUpdateYml(text: string): UpdateChannel {
  const owner = yamlScalar(text, 'owner')
  const repo = yamlScalar(text, 'repo')
  const provider = yamlScalar(text, 'provider')
  if (provider !== 'github') {
    throw new Error(`update feed provider must be github, got ${JSON.stringify(provider)}`)
  }
  if (owner === undefined || repo === undefined) {
    throw new Error('update feed yml is missing owner or repo')
  }
  return pinnedUpdateChannel({ owner, repo })
}

/**
 * Read the `version:` field from an electron-updater latest.yml body.
 * @param text - YAML body.
 * @returns the advertised version string.
 */
export function parseLatestYml(text: string): { version: string } {
  const version = yamlScalar(text, 'version')
  if (version === undefined || version.length === 0) {
    throw new Error('update feed has no version')
  }
  return { version }
}

/**
 * Compare two product versions. `v` and `desktop-v` prefixes are ignored.
 * @param left - installed or advertised version.
 * @param right - the other version.
 * @returns negative when left < right, zero when equal, positive when left > right.
 */
export function compareVersions(left: string, right: string): number {
  const a = versionParts(left)
  const b = versionParts(right)
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i += 1) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0)
    if (delta !== 0) return delta < 0 ? -1 : 1
  }
  return 0
}

/**
 * Whether a URL is the Saturn AI desktop release page on the product fork.
 * @param url - candidate URL.
 * @returns whether the renderer may open it as an update destination.
 */
export function isAllowedReleaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:'
      && parsed.hostname === SATURN_RELEASE_HOST
      && parsed.pathname.startsWith(SATURN_RELEASE_PREFIX)
  } catch {
    return false
  }
}

/**
 * Classify one check: YAML feed first, then the GitHub latest release as a
 * honest fallback when the feed is unpublished.
 * @param current - packaged application version.
 * @param feedVersion - version from latest.yml, or undefined when the feed is missing.
 * @param release - GitHub latest release, or undefined when the API is missing.
 * @returns the UI state for this check.
 */
export function classifyUpdate(input: {
  current: string
  feedVersion: string | undefined
  release: GithubLatestRelease | undefined
}): UpdateCheck {
  const current = input.current
  if (input.feedVersion !== undefined) {
    if (compareVersions(input.feedVersion, current) > 0) {
      const releaseUrl = input.release !== undefined && isAllowedReleaseUrl(input.release.html_url)
        ? input.release.html_url
        : `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`
      return { status: 'available', current, latest: input.feedVersion, releaseUrl }
    }
    return { status: 'current', current, feed: true }
  }
  if (input.release !== undefined) {
    const latest = input.release.tag_name
    const releaseUrl = isAllowedReleaseUrl(input.release.html_url)
      ? input.release.html_url
      : `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`
    if (compareVersions(latest, current) > 0) {
      return { status: 'available-no-feed', current, latest, releaseUrl }
    }
    return { status: 'current', current, feed: false }
  }
  return { status: 'empty', current }
}

/**
 * Copy for the native update dialog (window menu). Settings owns localized copy.
 * @param check - classified result.
 * @returns dialog fields; `openRelease` is the URL to open or undefined.
 */
export function updateDialogCopy(check: UpdateCheck): {
  message: string
  detail: string
  openRelease: string | undefined
} {
  switch (check.status) {
    case 'current':
      return {
        message: `Saturn AI ${check.current} is current`,
        detail: check.feed
          ? 'No newer version is on the update feed.'
          : 'This install matches the latest GitHub release. This channel has no auto-update feed yet.',
        openRelease: undefined,
      }
    case 'available':
      return {
        message: `Version ${check.latest} is available`,
        detail: `This install is ${check.current}. Open the GitHub release to download it. Saturn AI does not install updates silently.`,
        openRelease: check.releaseUrl,
      }
    case 'available-no-feed':
      return {
        message: `A newer installer (${check.latest}) is on GitHub`,
        detail: `This install is ${check.current}. This channel has no auto-update feed yet, so nothing will be downloaded from here.`,
        openRelease: check.releaseUrl,
      }
    case 'empty':
      return {
        message: 'No update feed yet',
        detail: `This install is ${check.current}. GitHub has not published an electron-updater feed (latest.yml) for this channel.`,
        openRelease: undefined,
      }
    case 'error':
      return {
        message: 'Could not check for updates',
        detail: check.message,
        openRelease: undefined,
      }
  }
}

function yamlScalar(text: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:\\s*(?:['"]([^'"]+)['"]|(\\S+))\\s*$`, 'm').exec(text)
  return match?.[1] ?? match?.[2]
}

function versionParts(raw: string): number[] {
  const stripped = raw.trim().replace(/^desktop-v/i, '').replace(/^v/i, '')
  const core = stripped.split('-')[0] ?? ''
  const parts = core.split('.').map((part) => {
    const n = Number.parseInt(part, 10)
    return Number.isFinite(n) ? n : 0
  })
  while (parts.length < 3) parts.push(0)
  return parts.slice(0, 3)
}
