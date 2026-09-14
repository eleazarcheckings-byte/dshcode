import type {
  AssistantBlock, AssistantMessageNode, CommandNode, CompactionSummaryNode,
  ConversationLocation, ConversationViewNode, ModelRetryNode, RunningToolCall,
  ToolCallBlock,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TurnEndReason } from '@deepseek-ai/dsh-session/types'

/** Final Chat render unit produced by a Chat business Definition. */
export interface ChatConversationViewNode extends ConversationViewNode {
  readonly target: 'chat'
  readonly anchorSeq: number
  readonly location: ConversationLocation
  readonly visibility: 'visible' | 'hidden'
}

/** Merge-extensible payload registry keyed by final Chat renderer kind. */
export interface ChatNodeDataMap {}

/** Renderer kinds contributed by the currently installed Chat business modules. */
export type ChatNodeKind = Extract<keyof ChatNodeDataMap, string>

/** Final Chat Node narrowed to one registered renderer kind and payload. */
export type ChatNode<Kind extends ChatNodeKind = ChatNodeKind> = {
  [RegisteredKind in Kind]: ChatConversationViewNode & {
    readonly kind: RegisteredKind
    readonly data: ChatNodeDataMap[RegisteredKind]
  }
}[Kind]

/** Final Assistant row payload shared by streaming and settled states. */
export interface AssistantChatData {
  readonly status: 'running' | 'settled' | 'interrupted'
  readonly turn: number
  readonly step: number
  readonly blocks: readonly AssistantBlock[]
  readonly time: number
  readonly usage?: unknown
  readonly finalNode?: AssistantMessageNode
}

/** Settled or interrupted Assistant payload with its durable presentation node. */
export type FinalAssistantChatData = AssistantChatData & {
  readonly finalNode: AssistantMessageNode
}

/** Root Tool row payload; the root lifecycle owns all recursive subcalls. */
export interface ToolChatData {
  readonly root: ToolCallBlock
}

/** One manual command and its correlated compaction transaction. */
export interface ManualCompactionChatData {
  readonly command: CommandNode
  readonly compaction: CompactionSummaryNode | null
}

/** One durable retry chain rendered as a single row. */
export interface RetryChatData {
  readonly attempts: readonly ModelRetryNode[]
  readonly current: ModelRetryNode
}

/** One provider/model route that contributed a billed request attempt. */
export interface TurnTokenUsageRoute {
  readonly provider: string
  readonly model: string
}

/** Exact provider-reported token accounting for every attempt in one completed Turn. */
export interface TurnTokenUsage {
  /** Sum of uncached prompt input across all attempts. */
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  /** Exact aggregate prompt plus output total across all attempts. */
  readonly totalTokens: number
  /** Present only when every attempt reported the bucket. */
  readonly cacheReadTokens?: number
  /** Present only when every attempt reported the bucket. */
  readonly cacheWriteTokens?: number
  /** Output subset, present only when every attempt reported it. */
  readonly reasoningTokens?: number
  /** Present only when every billed attempt has provider/model attribution. */
  readonly routes?: readonly TurnTokenUsageRoute[]
}

/** Turn-local footer row that owns actions and optional feature contributions. */
export interface TurnTailChatData {
  readonly turn: number
  readonly seq: number
  readonly time: number
  /**
   * Why this Turn closed, verbatim from its `turn/end` reason. Absent only on
   * hand-built fixtures; a crashed turn carries the persistence backend's
   * `interrupted` marker here. Read through {@link canContinueTurn}.
   */
  readonly endReason?: TurnEndReason | undefined
  /** Last finalized content-bearing Assistant in this Turn. */
  readonly closing: FinalAssistantChatData | null
  /** Whether non-rendered later evidence makes the closing seq non-tail. */
  readonly branchUnavailable: boolean
  readonly ttftMs?: number
  readonly tokensPerSecond?: number
  /** Exact per-Turn accounting; absent when the loaded evidence is incomplete. */
  readonly tokenUsage?: TurnTokenUsage
}

/**
 * Whether a closed Turn ended with work still owed, so a Continue affordance
 * belongs at its tail.
 *
 * `interrupted` is the only reason a live loop never emits: the persistence
 * backend writes it on reload for a turn whose `turn/end` never reached the log
 * (crash, kill, closed app), and the events recorded before the crash stay
 * intact. `aborted` is a cancellation request, and `error`/`max-tokens` close a
 * turn whose answer never completed. `completed` and `blocked` are excluded:
 * both ended the turn by design, so offering to continue would be a false
 * positive.
 * @param reason - the `turn/end` reason carried by the Turn's tail data.
 * @returns whether the Turn stopped short of a completed answer.
 */
export function canContinueTurn(reason: TurnEndReason | undefined): boolean {
  if (reason === undefined) return false
  switch (reason.kind) {
    case 'interrupted':
    case 'aborted':
    case 'error':
    case 'max-tokens':
      return true
    default:
      return false
  }
}

/** Turn-level process disclosure projected before the finalized answer. */
export interface TurnProcessChatData {
  readonly turn: number
  readonly controlAnchorSeq: number
  readonly processStartSeq: number
  readonly answerAnchorSeq: number | null
  readonly answerStep: number | null
  readonly inlineReasoning: boolean
  readonly messageCount: number
  readonly toolCallCount: number
  readonly subagentCount: number
}

/**
 * Test whether a Tool root has settled.
 * @param block - Tool root lifecycle value.
 * @returns whether the root carries its final result.
 */
export function isSettledTool(block: ToolCallBlock): block is Extract<ToolCallBlock, { kind: 'tool-result' }> {
  return 'kind' in block
}

/**
 * Test whether a Tool root is still running.
 * @param block - Tool root lifecycle value.
 * @returns whether the root lacks a final result.
 */
export function isRunningTool(block: ToolCallBlock): block is RunningToolCall {
  return !isSettledTool(block)
}
