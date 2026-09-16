/**
 * The Gate vocabulary: the classes of action that stop for a human, the two
 * outcomes a classified call can carry, and the shape of one policy rule.
 * Types only, so a consumer can read the vocabulary without loading the
 * plugin's Cordis augmentation.
 * @module @saturnai/dsh-gates/types
 */

/**
 * What kind of consequence makes a call a Gate. The five classes are the ones
 * whose consequence leaves the session: a secret read, money moved, something
 * made public, a message that reaches a real person, an identity or name
 * changed, or an effect nothing can undo.
 */
export type GateClass =
  | 'credentials'
  | 'spend'
  | 'publish'
  | 'outbound'
  | 'destructive'
  | 'identity'

/**
 * What a matched rule does. `ask` routes the call to the user and runs it only
 * if they allow it; `deny` refuses it outright, for the few effects no
 * approval should be able to buy from inside a session.
 */
export type GateAction = 'ask' | 'deny'

/**
 * One policy rule. A rule with no `pattern` matches on the tool name alone —
 * the shape every MCP rule uses, because an MCP tool's name already states its
 * effect. A rule WITH a pattern additionally requires the regular expression
 * to match the call's inspected text (the configured command fields), which is
 * how one shell tool carries both `ls` and a force push.
 */
export interface GateRule {
  /** Stable identifier, unique across the whole policy; named in the reason the model reads. */
  id: string
  /** The consequence class this rule guards. */
  class: GateClass
  /** `ask` (the default) or `deny`. */
  action?: GateAction
  /** Tool-name patterns, where `*` matches any run of characters and everything else is literal. */
  tools: string[]
  /** Optional regular expression over the call's inspected text, matched case-insensitively. */
  pattern?: string
  /** One sentence, written for the model, saying what the call would do. */
  reason: string
}

/** The classification of one call: which rule claimed it and what happens now. */
export interface GateMatch {
  /** The {@link GateRule.id} that claimed the call. */
  readonly ruleId: string
  /** The claimed call's consequence class. */
  readonly class: GateClass
  /** The resolved action (a rule that omits one asks). */
  readonly action: GateAction
  /** The rule's model-facing sentence. */
  readonly reason: string
}

/** The part of a pending tool call the policy reads. */
export interface GateCall {
  /** The tool name as the registry knows it (`bash`, `mcp__<server>__<tool>`). */
  readonly name: string
  /** The call's parsed arguments, or any non-object value when it has none. */
  readonly arguments: unknown
}
