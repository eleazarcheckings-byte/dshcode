/**
 * User-initiated update check against the electron-updater GitHub feed.
 * Does not download or install. A missing feed is reported honestly.
 */

import {
  classifyUpdate,
  githubLatestApiUrl,
  parseLatestYml,
  pinnedUpdateChannel,
  updateFeedUrl,
  type GithubLatestRelease,
  type UpdateChannel,
  type UpdateCheck,
} from './update-feed.ts'

export type { UpdateCheck, UpdateChannel, GithubLatestRelease }

/** Injectable network for tests. */
export interface UpdateFetcher {
  /** GET a URL and return status + text body. */
  (url: string, init?: { headers?: Record<string, string> }): Promise<{
    readonly status: number
    readonly text: string
  }>
}

const USER_AGENT = 'Saturn-AI-desktop'

/**
 * Check the pinned GitHub channel for a newer install. Never auto-downloads.
 * @param input.current - packaged application version.
 * @param input.platform - process.platform of this install.
 * @param input.fetch - network, defaulting to global fetch.
 * @returns the classified result for the UI.
 */
export async function checkForUpdates(input: {
  current: string
  platform: NodeJS.Platform
  fetch?: UpdateFetcher
  channel?: UpdateChannel
}): Promise<UpdateCheck> {
  const current = input.current
  try {
    const channel = pinnedUpdateChannel(input.channel)
    const get = input.fetch ?? defaultFetch
    const feed = await readFeed(get, updateFeedUrl(input.platform, channel))
    const release = await readLatestRelease(get, githubLatestApiUrl(channel))
    return classifyUpdate({
      current,
      feedVersion: feed,
      release,
    })
  } catch (error) {
    return {
      status: 'error',
      current,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

async function readFeed(get: UpdateFetcher, url: string): Promise<string | undefined> {
  const response = await get(url, { headers: { Accept: 'text/yaml, text/plain', 'User-Agent': USER_AGENT } })
  if (response.status === 404) return undefined
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`update feed HTTP ${String(response.status)}`)
  }
  const body = response.text.trim()
  if (body.length === 0) return undefined
  return parseLatestYml(body).version
}

async function readLatestRelease(
  get: UpdateFetcher,
  url: string,
): Promise<GithubLatestRelease | undefined> {
  const response = await get(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT },
  })
  if (response.status === 404) return undefined
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`GitHub releases HTTP ${String(response.status)}`)
  }
  return parseLatestRelease(response.text)
}

function parseLatestRelease(text: string): GithubLatestRelease {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value) || typeof value.tag_name !== 'string' || typeof value.html_url !== 'string') {
    throw new Error('GitHub latest release payload is malformed')
  }
  return { tag_name: value.tag_name, html_url: value.html_url }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const defaultFetch: UpdateFetcher = async (url, init) => {
  /* v8 ignore start -- tests inject a fetcher; packaged Electron uses global fetch */
  const response = init?.headers === undefined
    ? await fetch(url)
    : await fetch(url, { headers: init.headers })
  return { status: response.status, text: await response.text() }
  /* v8 ignore stop */
}
