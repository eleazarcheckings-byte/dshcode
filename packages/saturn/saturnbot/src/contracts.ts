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
