/**
 * First Light provider probe: one real, authenticated chat request against the
 * configured endpoint, used as the model step's live gate. The advisory catalog
 * a catalog provider ships is not evidence that a key works, so the gate cannot
 * be answered from local metadata — it must ask the provider. The probe sends a
 * single one-token message and judges only the HTTP outcome, so it never streams
 * a completion, never carries a key into a log or an error message, and never
 * parses a reply body that a proxy might shape differently.
 *
 * The catalog is still what the caller receives on success: discovery consumers
 * (the Models page and First Light) want adoptable model metadata, and the gate
 * wants proof of life. Both come from one request.
 *
 * @module @deepseek-ai/dsh-llm-deepseek/probe
 */

import { attributionHeaders, LlmError } from '@deepseek-ai/dsh-llm'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'
import type { DeepSeekConnectionOptions } from './adapter.ts'

/** Model id used when the connection's own catalog names no flash-family model. */
const FALLBACK_PROBE_MODEL = 'deepseek-v4-flash'

/** Worst-case duration of one probe; a hung socket must not gate the step forever. */
const PROBE_TIMEOUT_MS = 20_000

/**
 * Choose the cheapest model the connection knows about: a flash-family id is
 * the intended probe target, and any catalog entry is a better guess than a
 * hardcoded id when the deployment replaced its catalog.
 * @param connection - the resolved endpoint, catalog, and defaults.
 * @returns the probe model id.
 */
export function probeModelFor(connection: DeepSeekConnectionOptions): string {
  return connection.models.find(model => /flash/i.test(model.id))?.id
    ?? connection.models[0]?.id
    ?? FALLBACK_PROBE_MODEL
}

/**
 * Turn one resolved connection's catalog into the discovery reply, falling
 * back to the probed model when a deployment configured an empty catalog so a
 * successful probe never reads downstream as "listed no models".
 * @param connection - the resolved connection facts.
 * @param probeModel - the model the probe actually addressed.
 * @returns non-empty adoptable model metadata.
 */
function catalogReply(
  connection: DeepSeekConnectionOptions,
  probeModel: string,
): LlmDiscoveredModel[] {
  if (connection.models.length === 0) return [{ id: probeModel, name: probeModel }]
  return connection.models.map(model => ({
    id: model.id,
    ...model.name === undefined ? {} : { name: model.name },
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
  }))
}

/**
 * Perform the authenticated probe and return the adoptable catalog on success.
 *
 * Failure classification is the whole user-facing contract: each branch throws
 * an {@link LlmError} whose message is plain language, because that message
 * crosses the Remote boundary and is what the model step shows. The key is
 * never included in a message, a code, or a cause.
 *
 * @param connection - the resolved endpoint, catalog, and defaults.
 * @param apiKey - a usable bearer token (already trimmed and validated).
 * @param signal - caller cancellation; the probe must not outlive it.
 * @returns the connection's advisory catalog, non-empty.
 * @throws LlmError on any refusal, unreachable endpoint, or rate limit.
 */
export async function probeDeepSeekConnection(
  connection: DeepSeekConnectionOptions,
  apiKey: string,
  signal?: AbortSignal,
): Promise<readonly LlmDiscoveredModel[]> {
  const probeModel = probeModelFor(connection)
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS)
  const composed = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  let response: Response
  try {
    response = await fetch(`${connection.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'accept': 'application/json',
        ...attributionHeaders(),
      },
      body: JSON.stringify({
        model: probeModel,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: composed,
    })
  } catch (error: unknown) {
    if (signal?.aborted) throw new LlmError('the check was cancelled', 'ABORTED', { cause: error })
    if (timeout.aborted) {
      throw new LlmError(
        'DeepSeek did not answer in time. Check your connection and try again.',
        'PROBE_TIMEOUT',
        { cause: error },
      )
    }
    throw new LlmError(
      'Could not reach DeepSeek. Check your connection and try again.',
      'PROBE_UNREACHABLE',
      { cause: error },
    )
  }
  // Drain the body so the socket can be reused; the reply shape is not probed.
  await response.arrayBuffer().catch(() => undefined)
  if (!response.ok) throw refusalForStatus(response.status)
  return catalogReply(connection, probeModel)
}

/**
 * Map one provider status onto the honest, plain-language failure the model
 * step shows. The distinctions are the ones a user can act on: a wrong key, a
 * rate limit, and a provider-side outage each read differently.
 * @param status - the HTTP status the provider answered.
 * @returns the failure to raise.
 */
function refusalForStatus(status: number): LlmError {
  if (status === 401 || status === 403) {
    return new LlmError('DeepSeek rejected this API key. Check the key and try again.', 'INVALID_CREDENTIAL', { status })
  }
  if (status === 429) {
    return new LlmError('DeepSeek is rate-limiting this key. Wait a moment and check again.', 'RATE_LIMIT', { status })
  }
  if (status >= 500) {
    return new LlmError('DeepSeek is having trouble right now. Try again shortly.', 'PROBE_UNAVAILABLE', { status })
  }
  return new LlmError(`DeepSeek refused the check (status ${String(status)}).`, 'PROBE_REFUSED', { status })
}
