/**
 * Client half of the Hugging Face route: routed model ids, the adapter's
 * live-model description line, and the router failure tags. The adapter
 * (`dsh-llm-pi-ai`, `live-models.ts`) owns the same grammar on the Host side;
 * the client cannot import it, so the few rules are restated here and pinned
 * by specs on both sides.
 */

/** The route key the base bundle declares for the Hugging Face router. */
export const HF_ROUTE = 'huggingface'

/** Router routing policies; `fastest` is the router default and is sent bare. */
export const ROUTING_POLICIES = ['fastest', 'cheapest', 'preferred'] as const

/** One routing policy. */
export type RoutingPolicy = typeof ROUTING_POLICIES[number]

const MODEL_ID = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/u
const SUFFIX = /^[\w.-]+$/u

/**
 * Split a routed id into its `org/name` base and optional suffix.
 * @param id - the model id.
 * @returns base and suffix (undefined when none).
 */
export function splitRoutedModelId(id: string): { base: string; suffix: string | undefined } {
  const at = id.indexOf(':')
  return at < 0 ? { base: id, suffix: undefined } : { base: id.slice(0, at), suffix: id.slice(at + 1) }
}

/**
 * Whether an id has the router's `org/name[:suffix]` shape.
 * @param id - the candidate id.
 * @returns true when the router can be asked for it.
 */
export function isRoutableModelId(id: string): boolean {
  const { base, suffix } = splitRoutedModelId(id)
  return MODEL_ID.test(base) && (suffix === undefined || SUFFIX.test(suffix))
}

/**
 * Apply a routing choice to an id; an id already carrying a suffix is kept.
 * @param id - `org/name` or `org/name:suffix`.
 * @param choice - a policy or a provider name.
 * @returns the id to select.
 * @throws Error when the id is not routable.
 */
export function withRoutingSuffix(id: string, choice: string | undefined): string {
  if (!isRoutableModelId(id)) throw new Error(`not an org/name model id: ${id}`)
  if (id.includes(':') || choice === undefined || choice === 'fastest') return id
  return `${id}:${choice}`
}

/** What a live model's description line discloses. */
export interface LiveDescription {
  /** Compact context size (`131K`), when disclosed. */
  context?: string
  /** Whether any live provider supports tools. */
  tools: boolean
  /** Live provider names. */
  providers: readonly string[]
}

/**
 * Read the adapter's `131K context · tools · via a, b` line.
 * @param description - a catalog model's description.
 * @returns the facts, or undefined when the line is not in that grammar.
 */
export function parseLiveDescription(description: string | undefined): LiveDescription | undefined {
  if (description === undefined || description.length === 0) return undefined
  let context: string | undefined
  let tools = false
  let providers: string[] = []
  for (const part of description.split(' · ')) {
    const size = /^(\d+(?:\.\d+)?[KM]) context$/u.exec(part)
    const via = /^via (.+)$/u.exec(part)
    if (size?.[1] !== undefined) context = size[1]
    else if (part === 'tools') tools = true
    else if (via?.[1] !== undefined) providers = via[1].split(', ')
    else return undefined
  }
  return { ...context === undefined ? {} : { context }, tools, providers }
}

/** The locale keys a tagged router failure maps to. */
export type HuggingFaceErrorKey =
  | 'hf.error.unauthorized' | 'hf.error.credits' | 'hf.error.gated' | 'hf.error.notFound' | 'hf.error.rateLimited'

/**
 * The localized key for a `[huggingface:<kind>]` failure message.
 * @param message - a failure message from the Host.
 * @returns the key, or undefined for any other message.
 */
export function huggingFaceErrorKey(message: string | undefined): HuggingFaceErrorKey | undefined {
  const kind = /\[huggingface:(unauthorized|credits|gated|notFound|rateLimited)\]/u.exec(message ?? '')?.[1]
  return kind === undefined ? undefined : `hf.error.${kind}` as HuggingFaceErrorKey
}

/** The credential reference the `huggingface` route names (`apiKeyEnv`). */
export const HF_TOKEN_REF = 'HF_TOKEN'

/** The router endpoint the base bundle declares. */
export const HF_ROUTER_URL = 'https://router.huggingface.co/v1'

/** Fine-grained token page, pre-set to the "Make calls to Inference Providers" permission. */
export const HF_TOKEN_URL = 'https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained'

/** Where exhausted Inference Providers credits are topped up. */
export const HF_BILLING_URL = 'https://huggingface.co/settings/billing'
