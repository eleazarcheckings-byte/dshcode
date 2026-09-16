/**
 * Absolute http(s) URL checks for browser verify tools. Relative URLs, credentials,
 * non-http(s) schemes, and link-local/cloud-metadata hosts are rejected before
 * Playwright sees them. Loopback (`127.0.0.1`, `::1`) and RFC1918 private
 * ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) stay reachable —
 * developers verify local dev servers through this tool, and those ranges
 * describe the machine's own network, not a cloud instance-metadata endpoint.
 * @module @deepseek-ai/dsh-tool-browser/urls
 */

/**
 * Strip the brackets WHATWG URL keeps around a literal IPv6 host
 * (`[::1]` → `::1`); every other hostname passes through unchanged.
 * @param hostname - `URL.hostname` as parsed.
 * @returns the bracket-free host.
 */
function unwrapIPv6(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) return hostname.slice(1, -1)
  return hostname
}

/**
 * Test one already-canonicalized IPv4 dotted-decimal string for the
 * `169.254.0.0/16` link-local range, which carries cloud instance metadata
 * (`169.254.169.254`) on every major provider.
 * @param dotted - a `a.b.c.d` string.
 * @returns whether the address falls in `169.254.0.0/16`.
 */
function isLinkLocalIPv4(dotted: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/u.exec(dotted)
  if (match?.[1] === undefined || match[2] === undefined) return false
  return Number(match[1]) === 169 && Number(match[2]) === 254
}

/**
 * Recognize a link-local or cloud-metadata host: IPv4 `169.254.0.0/16`
 * (including the same range embedded in an IPv4-mapped IPv6 literal), or
 * IPv6 `fe80::/10`. `URL.hostname` already canonicalizes hex/octal/decimal
 * IPv4-looking hosts to dotted-decimal, so this check runs on that
 * canonical form rather than re-parsing the raw input.
 * @param hostname - `URL.hostname` as parsed (still bracketed for IPv6).
 * @returns whether the host must be refused as link-local.
 */
export function isLinkLocalHost(hostname: string): boolean {
  const host = unwrapIPv6(hostname).toLowerCase()
  if (isLinkLocalIPv4(host)) return true
  if (/^fe[89ab][0-9a-f]:/u.test(host)) return true
  const mapped = /^::ffff:([0-9a-f:.]+)$/u.exec(host)
  if (mapped?.[1] !== undefined) {
    if (isLinkLocalIPv4(mapped[1])) return true
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(mapped[1])
    if (hex?.[1] !== undefined) {
      const first = Number.parseInt(hex[1], 16)
      if (((first >> 8) & 0xff) === 169 && (first & 0xff) === 254) return true
    }
  }
  return false
}

/**
 * Parse a model-supplied URL into a canonical absolute http(s) href.
 * @param raw - the tool argument.
 * @returns the canonical href, including the trailing slash URL normalization applies.
 * @throws when the value is empty, not absolute, not http(s), includes userinfo, or targets a link-local/cloud-metadata host.
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
  if (isLinkLocalHost(parsed.hostname)) {
    throw new Error(
      `browser: url host is link-local or cloud instance metadata (${parsed.hostname}); `
      + 'this range is refused even though loopback and private-network hosts are allowed',
    )
  }
  return parsed.href
}
