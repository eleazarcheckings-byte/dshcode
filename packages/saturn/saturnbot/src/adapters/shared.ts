/** Shared adapter admission, bounded output, and configured HTTP transport. */
import { z, type ZodRawShape } from 'zod'
import type { BotTool, BotToolContext, BotToolResult } from '../contracts.ts'
import type { BotJson } from '../types.ts'
import type { BotToolOptions } from '../tools.ts'

/** Limit untrusted remote/file output before parsing or logging it. */
export const MAX_ADAPTER_BYTES = 131_072
/** Maximum retained text in one tool result. */
export const MAX_RESULT_TEXT = 16_384

/** An integration needs operator configuration or renewed access. */
export class ActionRequiredError extends Error {
  /** Stable adapter failure code for missing configuration or denied provider access. */
  readonly code = 'action-required'
  constructor(message: string) { super(message); this.name = 'ActionRequiredError' }
}

/** A provider failure with a locally authored message safe to retain in traces. */
class ProviderResponseError extends Error {}

/** Create a validated tool whose definition remains the role and effect authority.
 * @param metadata - Trusted name, role ceiling, effect, retry policy, and optional evaluation input.
 * @param fields - Strict input object fields.
 * @param execute - Adapter implementation over validated fields.
 * @returns immutable-by-convention definition consumed by the central engine.
 */
export function tool<S extends ZodRawShape>(
  metadata: Omit<BotTool, 'input' | 'execute'>,
  fields: S,
  execute: (input: z.infer<z.ZodObject<S>>, context: BotToolContext) => Promise<BotToolResult>,
): BotTool {
  const schema = z.object(fields).strict()
  return {
    ...metadata,
    input: schema as unknown as BotTool['input'],
    execute: async (input, context) => {
      context.signal.throwIfAborted()
      return await execute(schema.parse(input), context)
    },
  }
}

/** Redact configured credential values and common credential assignments before retaining text.
 * @param value - Potentially untrusted provider or process text.
 * @param options - Environment source containing configured secret values.
 * @param context - Named integration credential references.
 * @returns bounded, redacted text with an explicit truncation suffix.
 */
export function redact(value: string, options: BotToolOptions, context: BotToolContext): string {
  let text = value
  const environment = options.environment ?? process.env
  for (const integration of Object.values(context.config.integrations)) {
    const secret = integration.credentialEnv === undefined ? undefined : environment[integration.credentialEnv]
    if (secret) text = text.replaceAll(secret, '[redacted]')
  }
  text = text.replace(/\b(?:Bearer|Basic)\s+[a-z0-9+/_=.\-]+/giu, '[redacted authorization]')
    .replace(/((?:api[_-]?key|access[_-]?token|password|secret)\s*[=:]\s*)[^\s,;]+/giu, '$1[redacted]')
  return text.length > MAX_RESULT_TEXT ? `${text.slice(0, MAX_RESULT_TEXT)}\n[truncated]` : text
}

/** Resolve only a user-configured integration; credentials never appear in its returned URL.
 * @param options - Host environment snapshot.
 * @param context - Current validated configuration.
 * @param name - Stable integration key.
 * @param defaultEndpoint - Official service endpoint when the integration omits one.
 * @returns canonical HTTPS origin/base and a resolved bearer token.
 */
export function integration(
  options: BotToolOptions, context: BotToolContext, name: string, defaultEndpoint?: string,
): { endpoint: string; token: string; resource: string | undefined } {
  const config = context.config.integrations[name]
  if (config === undefined) throw new ActionRequiredError(`Connect ${name} in SaturnBot settings.`)
  const endpoint = config.endpoint ?? defaultEndpoint
  if (endpoint === undefined) throw new ActionRequiredError(`Configure the ${name} endpoint.`)
  let url: URL
  try { url = new URL(endpoint) } catch { throw new ActionRequiredError(`Configure a valid HTTPS endpoint for ${name}.`) }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new ActionRequiredError(`${name} requires an HTTPS endpoint without embedded credentials, query, or fragment.`)
  }
  const token = config.credentialEnv === undefined ? undefined : (options.environment ?? process.env)[config.credentialEnv]
  if (!token) throw new ActionRequiredError(`Set the credential environment variable configured for ${name}.`)
  return { endpoint: url.href.replace(/\/$/u, ''), token, resource: config.resource }
}

/** Read a bounded JSON response and reject malformed, redirected, or oversized provider output.
 * @param options - Fetch dependency.
 * @param context - Tool deadline and cancellation.
 * @param url - Exact configured API endpoint.
 * @param init - Headers and request body selected by the adapter.
 * @param schema - Expected provider response fields.
 * @param expectedStatus - Exact provider status when acceptance semantics require one.
 * @returns validated JSON response, with unrecognized provider fields stripped by its schema.
 */
export async function request<T>(
  options: BotToolOptions, context: BotToolContext, url: string,
  init: RequestInit, schema: z.ZodType<T>, expectedStatus?: number,
): Promise<T> {
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(context.config.toolTimeoutMs)])
  try {
    return await readResponse(options, signal, url, init, schema, expectedStatus)
  } catch (error) {
    if (signal.aborted) throw new Error('Connected service request was cancelled or timed out.')
    if (error instanceof ActionRequiredError || error instanceof ProviderResponseError) throw error
    // Transport errors, JSON excerpts, and provider validation errors can contain credentials.
    throw new Error('Connected service request failed or returned invalid JSON.')
  }
}

async function readResponse<T>(
  options: BotToolOptions, signal: AbortSignal, url: string,
  init: RequestInit, schema: z.ZodType<T>, expectedStatus?: number,
): Promise<T> {
  const response = await (options.fetch ?? globalThis.fetch)(url, { ...init, redirect: 'error', signal })
  if (!response.ok) {
    await response.body?.cancel()
    if (response.status === 401 || response.status === 403) throw new ActionRequiredError(`The connected service refused access (${response.status}). Check its credential and permissions.`)
    throw new ProviderResponseError(`Connected service returned HTTP ${response.status}.`)
  }
  if (expectedStatus !== undefined && response.status !== expectedStatus) { await response.body?.cancel(); throw new ProviderResponseError(`Connected service did not return the required HTTP ${expectedStatus} acknowledgment.`) }
  if (response.status === 204) { await response.body?.cancel(); return schema.parse(null) }
  const reader = response.body?.getReader()
  if (reader === undefined) return schema.parse(null)
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const item = await reader.read()
      if (item.done) break
      length += item.value.byteLength
      if (length > MAX_ADAPTER_BYTES) { await reader.cancel(); throw new ProviderResponseError('Connected service response exceeded the permitted size.') }
      chunks.push(item.value)
    }
  } finally { reader.releaseLock() }
  return schema.parse(length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString('utf8')))
}

/** Retain whole JSON rows within one model-output budget.
 * @param values - Validated rows, already redacted where applicable.
 * @returns complete retained rows and an explicit omitted-row count.
 */
export function boundedRows(values: unknown[]): { items: BotJson[]; omitted: number } {
  const items: BotJson[] = []
  let size = 0
  for (const value of values) {
    const item = json(value)
    const length = Buffer.byteLength(JSON.stringify(item))
    if (size + length > MAX_RESULT_TEXT * 2) break
    size += length
    items.push(item)
  }
  return { items, omitted: values.length - items.length }
}

/** Return a JSON object after runtime validation instead of passing provider objects through.
 * @param value - Already validated JSON-compatible value.
 * @returns the same value with the common tool result type.
 */
export function json(value: unknown): BotJson {
  return z.json().parse(value)
}

/** Remove configured credentials from every retained JSON string and credential-named field.
 * @param value - JSON-compatible provider data.
 * @param options - Configured environment source.
 * @param context - Credential references for this invocation.
 * @returns JSON retaining ordinary provider fields while redacting secrets.
 */
export function redactedJson(value: unknown, options: BotToolOptions, context: BotToolContext): BotJson {
  const clean = (item: BotJson): BotJson => {
    if (typeof item === 'string') return redact(item, options, context)
    if (Array.isArray(item)) return item.map(clean)
    if (item !== null && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, /authorization|password|secret|token|api[-_]?key/iu.test(key) ? '[redacted]' : clean(child)]))
    return item
  }
  return clean(json(value))
}
