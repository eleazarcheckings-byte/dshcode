/** Runtime interfaces used by model, tools, persistence, and host scheduling adapters. */
import type { ZodType } from 'zod'
import type { AgentProposal, BotConfig, BotEventData, BotId, BotJson, BotRole, BotSnapshot, BotStage, BotTask } from './types.ts'

/** Public planning context; contains recorded summaries rather than hidden reasoning. */
export interface BotModelContext {
  config: BotConfig
  state: BotSnapshot
  cycleId: BotId
  branchId: BotId | null
  observedState: Record<string, BotJson>
  signal: AbortSignal
  tools: { name: string
    description: string
    roles: readonly BotRole[]
    effect: ToolEffect
    parameters: BotJson }[]
}
/** Planner/model adapter returns unknown so runtime JSON schemas remain authoritative. */
export interface BotModel {
  plan(context: BotModelContext): Promise<unknown>
  propose(task: BotTask, context: BotModelContext): Promise<unknown>
}
/** Publication classes controlled by the runtime, never supplied by model output. */
export type ToolEffect = 'read' | 'stage' | 'validate' | 'pr' | 'email' | 'deploy' | 'write' | 'social' | 'draft' | 'report' | 'memory'
/** An admitted tool invocation, with a stable deduplication key. */
export interface BotToolContext {
  config: BotConfig
  cycleId: BotId
  branchId: BotId
  role: BotRole
  signal: AbortSignal
  idempotencyKey: string
  stage: BotStage | null
}
/** Tool results are bounded and validated before logging or further dispatch. */
export interface BotToolResult {
  summary: string
  data?: BotJson
  stage?: BotStage
  validatedRevision?: string
}
/** A trusted adapter declares its immutable role ceiling and retry semantics. */
export interface BotTool {
  name: string
  description: string
  roles: readonly BotRole[]
  effect: ToolEffect
  retry: 'safe' | 'idempotent' | 'never'
  input: ZodType<Record<string, BotJson>>
  /** Optional read-only input evaluated before planning, under orchestrator policy. */
  evaluationInput?: Record<string, BotJson>
  execute(input: Record<string, BotJson>, context: BotToolContext): Promise<BotToolResult>
}
/** Specialist agent abstraction. */
export interface BotAgent {
  role: Exclude<BotRole, 'orchestrator'>
  propose(task: BotTask, context: BotModelContext): Promise<AgentProposal>
}
/** Planning abstraction selecting at most the configured one-to-three tasks. */
export interface BotOrchestrator { plan(context: BotModelContext): Promise<{
  summary: string
  tasks: BotTask[] }>
}
/** Persistence API used by the engine; an acquired lease excludes other processes. */
export interface BotExecutionState {
  snapshot(): Promise<BotSnapshot>
  append(event: BotEventData): Promise<void>
  acquireLease(): Promise<() => Promise<void>>
}
/** Host-only scheduler lifetime; it does not wake a stopped host. */
export interface BotScheduler {
  start(): void
  dispose(): Promise<void>
}

/** One media generation or transform job, as the connected media provider reports it. */
export interface BotMediaJob {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed'
  assets: Array<{ path: string; mimeType: string; url?: string }>
  cost: { estimatedUsd: number; provider: string; model: string }
}
/**
 * Duck-typed contract for the connected media capability (`ctx.get('media')`,
 * provided by the `@saturnai/dsh-tool-media` package when mounted). SaturnBot
 * depends only on this shape, never on that package directly, so the two can
 * ship and version independently.
 */
export interface BotMediaService {
  generate(request: {
    kind: 'image' | 'video' | 'audio' | 'motion-transfer'
    prompt: string
    provider?: string
    model?: string
    params?: Record<string, unknown>
    workspace: string
  }): Promise<BotMediaJob>
  status(id: string): Promise<BotMediaJob>
}

/** Model tiers a connected router chooses between for one resolution. */
export type BotModelTier = 'coordinator' | 'specialist' | 'bulk' | 'vision'
/** One resolved route: which provider/model (and optional reasoning effort) to call. */
export interface BotModelRoute { provider: string; model: string; reasoningEffort?: string }
/**
 * Duck-typed contract for the connected model-router capability
 * (`ctx.get('modelRouter')`, provided by `@saturnai/dsh-model-router` when
 * mounted). Planner and specialist calls resolve `coordinator` and
 * `specialist` respectively; a router that throws or omits a field is
 * treated as absent for that call, falling back to the configured
 * `provider`/`model`. A resolved `reasoningEffort` the target model does not
 * declare is dropped, keeping the resolved `provider`/`model` — it never
 * hard-fails the call.
 */
export interface BotModelRouter { resolve(tier: BotModelTier): BotModelRoute }
