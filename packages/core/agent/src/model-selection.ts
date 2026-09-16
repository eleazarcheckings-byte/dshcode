/**
 * Agent-scoped model selection shared by runtime entry points.
 * @module @deepseek-ai/dsh-agent/model-selection
 */

import type { Context } from '@deepseek-ai/cordis'
import { ReasoningEffortId, type LlmCallConfig } from '@deepseek-ai/dsh-llm'

/** Complete provider, model, and optional reasoning effort selected for one live Agent. */
export interface ModelSelection {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: ReasoningEffortId
}

/** Mutable model selection plus the value captured for the current step. */
export interface ModelSelectionRef {
  /** Model selected for the next step that enters prompt assembly. */
  current: ModelSelection | undefined
  /** Selection captured when the current step entered prompt assembly. */
  assembled: ModelSelection | undefined
}

/**
 * Couple one mutable selection to Agent-scoped prompt assembly and request routing.
 * Prompt assembly snapshots the selected model before delegating, then applies
 * its provider/model pair and effort to request config so a
 * concurrent switch takes effect on a later step instead of splitting the two
 * surfaces. An absent selected effort clears any inherited effort, restoring
 * the selected model's provider/default behavior. When a model router is
 * mounted, an image-bearing request is then rerouted to a seeing model; that
 * switch outranks the assembled selection so it actually reaches the wire.
 *
 * @param agentCtx - The selected Agent's scoped context.
 * @param selection - Mutable selection owned by the calling entry point.
 * @returns Disposer for both scoped waterfall listeners.
 */
export function installModelSelection(agentCtx: Context, selection: ModelSelectionRef): () => void {
  const disposeAssembly = agentCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const selected = selection.current
    const assembled = await next()
    selection.assembled = selected
    if (selected === undefined) return assembled
    return {
      ...assembled,
      variables: {
        ...assembled.variables,
        provider: selected.provider,
        model: selected.model,
      },
    }
  })
  const disposeRequest = agentCtx.on(
    'agent/request',
    async (payload, next): Promise<LlmCallConfig> => {
      const resolved = await next()
      const selected = selection.assembled
      const routed: LlmCallConfig = selected === undefined
        ? resolved
        : applySelection(resolved, selected)

      const router = visionRouter(agentCtx.get('modelRouter'))
      if (router === undefined) return routed

      const session = agentSession(payload.agent)
      const messages = session?.deriveMessages()
      if (!Array.isArray(messages)) return routed

      try {
        const decision = await router.resolveForRequest({
          provider: routed.provider,
          model: routed.model,
          messages,
        })
        if (!decision.switched) return routed
        session?.append('model/vision-route', {
          provider: decision.provider,
          model: decision.model,
          from: { provider: routed.provider, model: routed.model },
          reason: decision.reason,
        })
        return {
          ...routed,
          provider: decision.provider,
          model: decision.model,
          ...decision.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: ReasoningEffortId(String(decision.reasoningEffort)) },
        }
      } catch {
        return routed
      }
    },
  )
  return () => {
    disposeAssembly()
    disposeRequest()
  }
}

/** Apply a captured selection over inherited request config, clearing inherited effort when unset. */
function applySelection(resolved: LlmCallConfig, selected: ModelSelection): LlmCallConfig {
  const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved
  return {
    ...withoutInheritedEffort,
    provider: selected.provider,
    model: selected.model,
    ...selected.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: selected.reasoningEffort },
  }
}

/** Duck-typed vision router; the Saturn model-router package is optional at this layer. */
interface VisionRouter {
  resolveForRequest: (request: {
    provider: string
    model: string
    messages: unknown
  }) => Promise<{
    provider: string
    model: string
    switched: boolean
    reason?: string
    reasoningEffort?: string
  }>
}

/**
 * Whether `value` exposes `resolveForRequest`.
 * @param value - `ctx.get('modelRouter')`, which may be absent.
 * @returns the router, or undefined when the verb is missing.
 */
function visionRouter(value: unknown): VisionRouter | undefined {
  if (value === undefined || value === null || typeof value !== 'object') return undefined
  const router = value as Record<string, unknown>
  if (typeof router['resolveForRequest'] !== 'function') return undefined
  return value as VisionRouter
}

/** Session verbs the vision hook uses. */
interface AgentSessionSurface {
  deriveMessages: () => unknown
  append: (type: string, data: unknown) => unknown
}

/**
 * Read the live session off an agent handle without taking a Saturn dependency.
 * @param agent - the agent making the request.
 * @returns the session surface, or undefined when it is missing.
 */
function agentSession(agent: unknown): AgentSessionSurface | undefined {
  if (agent === undefined || agent === null || typeof agent !== 'object') return undefined
  const session = (agent as { session?: unknown }).session
  if (session === undefined || session === null || typeof session !== 'object') return undefined
  const surface = session as Record<string, unknown>
  if (typeof surface['deriveMessages'] !== 'function' || typeof surface['append'] !== 'function') {
    return undefined
  }
  return session as AgentSessionSurface
}
