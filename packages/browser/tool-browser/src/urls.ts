/**
 * Absolute http(s) URL checks for browser verify tools. Relative URLs, credentials,
 * and non-http(s) schemes are rejected before Playwright sees them.
 * @module @deepseek-ai/dsh-tool-browser/urls
 */

/**
 * Parse a model-supplied URL into a canonical absolute http(s) href.
 * @param raw - the tool argument.
 * @returns the canonical href, including the trailing slash URL normalization applies.
 * @throws when the value is empty, not absolute, not http(s), or includes userinfo.
 */
export function parseBrowserUrl(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) throw new Error('browser: url must be a non-empty http(s) URL')
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`browser: url is not a valid absolute URL: ${trimmed}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`browser: only http(s) URLs are supported (got ${parsed.protocol})`)
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('browser: url must not include user credentials')
  }
  return parsed.href
}
