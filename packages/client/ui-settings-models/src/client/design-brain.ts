/**
 * The Design brain connection probe. The SaturnAI brain speaks MCP over a
 * single HTTP endpoint, so "Connected" can only mean the endpoint actually
 * answered a JSON-RPC handshake and named its tools — a step that reported
 * Connected without that answer would be a lie the user carries into every
 * later session. Every failure path returns `unreachable`; none of them
 * guesses success.
 *
 * Host-side verify API: NOT ASSESSED, deliberately. The probe runs in the
 * renderer against `https://saturnai.tools/api/mcp`; a Host `@Remote('verify')`
 * would only add a hop, because the endpoint speaks CORS to this origin.
 * Measured 2026-09-14: a preflight from a loopback origin answers
 * `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Methods: GET,
 * POST, OPTIONS` and `Access-Control-Allow-Headers: Authorization,
 * Content-Type`, and a live `initialize` POST returns a JSON-RPC result from
 * server `saturnai/1.7.0`. The packaged desktop renderer enforces the same
 * CORS rules a browser does, so the handshake cannot be blocked in the app and
 * no Host API exists to mark green.
 */

import { en } from './locales.ts'

/** The public SaturnAI brain endpoint the Design brain step points at. */
export const DESIGN_BRAIN_ENDPOINT = 'https://saturnai.tools/api/mcp'

/** What one Design brain verification answered. */
export type DesignBrainOutcome =
  /** The endpoint completed a handshake; the names it advertised. */
  | { readonly kind: 'verified'; readonly tools: readonly string[] }
  /** The endpoint did not answer, or answered a refusal. */
  | { readonly kind: 'unreachable'; readonly message: string }

/** MCP's protocol revision spoken by this probe. */
const MCP_PROTOCOL_VERSION = '2025-06-18'

/** One JSON-RPC request body. */
function requestBody(id: number, method: string, params?: unknown): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    ...params === undefined ? {} : { params },
  })
}

/** Read a JSON-RPC result object, or undefined when the body is not one. */
async function jsonResult(response: Response): Promise<Record<string, unknown> | undefined> {
  const body: unknown = await response.json().catch(() => undefined)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const result = (body as Record<string, unknown>).result
  return typeof result === 'object' && result !== null && !Array.isArray(result)
    ? result as Record<string, unknown>
    : undefined
}

/**
 * Probe one MCP endpoint with a real handshake.
 * @param endpoint - the brain's HTTP MCP endpoint.
 * @param fetchImpl - the fetch to use (injected so tests can script it).
 * @returns the advertised tool names when the endpoint truly answered.
 */
export async function verifyDesignBrain(
  endpoint: string = DESIGN_BRAIN_ENDPOINT,
  fetchImpl: typeof fetch = fetch,
): Promise<DesignBrainOutcome> {
  try {
    const init = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: requestBody(1, 'initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'saturn-ai-desktop', version: '1.0.0' },
      }),
    })
    if (!init.ok) {
      return { kind: 'unreachable', message: `the endpoint answered ${String(init.status)}` }
    }
    if (await jsonResult(init) === undefined) {
      return { kind: 'unreachable', message: 'the endpoint did not answer a handshake' }
    }
    const list = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: requestBody(2, 'tools/list'),
    })
    if (!list.ok) {
      return { kind: 'unreachable', message: `the endpoint answered ${String(list.status)}` }
    }
    const result = await jsonResult(list)
    const tools = result?.tools
    if (!Array.isArray(tools)) {
      return { kind: 'unreachable', message: 'the endpoint listed no tools' }
    }
    const names = tools
      .map(tool => (typeof tool === 'object' && tool !== null && !Array.isArray(tool)
        ? (tool as Record<string, unknown>).name
        : undefined))
      .filter((name): name is string => typeof name === 'string' && name.length > 0)
    if (names.length === 0) {
      return { kind: 'unreachable', message: 'the endpoint listed no tools' }
    }
    return { kind: 'verified', tools: names }
  } catch (error) {
    // The fallback is user-visible copy, so it belongs to the dictionary; the
    // error's own message already arrives localized where one exists.
    const message = error instanceof Error ? error.message : en.firstLightBrainRequestFailed
    return { kind: 'unreachable', message }
  }
}
