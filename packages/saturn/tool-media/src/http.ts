/**
 * Shared HTTP plumbing for every provider: bounded reads (a runaway or hostile
 * response can never exhaust process memory) and a same-origin-only redirect
 * policy, following {@link packages/vision/tool-describe-image}'s convention —
 * every credential-bearing request refuses redirects outright, so a bearer/API
 * key can never be forwarded to a host the caller did not configure. The single
 * documented exception ({@link fetchAllowingRedirectTo}) exists only for Gemini's
 * own signed video-download step (see `providers/gemini.ts`), and even then only
 * within an explicit allow-list of hosts.
 * @module @saturnai/dsh-tool-media/http
 */

/**
 * Read a response body up to a byte cap, rejecting the whole response beyond it.
 * @param response - the response to drain.
 * @param cap - the byte bound.
 * @returns the accumulated body bytes.
 */
export async function readBoundedBody(response: Response, cap: number): Promise<Buffer> {
  if (response.body === null) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      total += chunk.length
      if (total > cap) throw new Error(`media: response exceeds the ${cap}-byte bound`)
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}

/**
 * Read a response body as text, truncated to a character cap (error excerpts only).
 * @param response - the response to drain.
 * @param cap - the character cap.
 * @returns the decoded text, never longer than `cap` characters.
 */
export async function readBoundedText(response: Response, cap: number): Promise<string> {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      if (text.length > cap) return text.slice(0, cap)
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  return text.length > cap ? text.slice(0, cap) : text
}

/**
 * Read a non-2xx response into a short error excerpt, for a uniform HTTP-failure message
 * across every provider.
 * @param label - the calling provider/operation label, e.g. `gemini: image generation`.
 * @param response - the failed response.
 * @returns a throwable {@link Error} carrying the status and a bounded body excerpt.
 */
export async function httpFailure(label: string, response: Response): Promise<Error> {
  const excerpt = await readBoundedText(response, 400)
  return new Error(`${label}: HTTP ${response.status}${excerpt.length > 0 ? `: ${excerpt}` : ''}`)
}

/**
 * Issue a credential-bearing request that refuses ANY redirect — the default
 * posture for every provider call in this package except the one documented
 * exception in `providers/gemini.ts`.
 * @param url - absolute request URL.
 * @param init - fetch options; `redirect` is always overridden to `'error'`.
 * @param signal - caller cancellation, combined with any timeout the caller already put on `init.signal`.
 */
export function fetchNoRedirect(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  return fetch(url, {
    ...init,
    redirect: 'error',
    ...signal !== undefined ? { signal } : {},
  })
}

/**
 * Fetch a provider-issued URL that may answer with a single 3xx to a signed
 * download location, forwarding `init`'s headers to the redirect target ONLY
 * when its host is in `allowedHosts` — otherwise the credential stays home and
 * the call throws. Used exclusively for Gemini's documented Veo download flow
 * (`curl -L -H "x-goog-api-key: ..." "$video_uri"`), where the official example
 * follows a same-host redirect while carrying the API key header.
 * @param url - the signed URL to fetch.
 * @param init - fetch options (credential headers included).
 * @param allowedHosts - hosts the credential may still be sent to after one hop.
 * @returns the final response (never itself a further redirect: a second hop throws).
 */
export async function fetchAllowingRedirectTo(url: string, init: RequestInit, allowedHosts: readonly string[]): Promise<Response> {
  const first = await fetch(url, { ...init, redirect: 'manual' })
  if (first.status < 300 || first.status >= 400) return first
  const location = first.headers.get('location')
  if (location === null) return first
  const target = new URL(location, url)
  if (!allowedHosts.includes(target.host)) {
    throw new Error(`media: refusing to follow a redirect to untrusted host "${target.host}"`)
  }
  const second = await fetch(target.href, { ...init, redirect: 'error' })
  return second
}
