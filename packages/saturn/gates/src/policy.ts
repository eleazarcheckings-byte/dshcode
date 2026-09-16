/**
 * Policy compilation and classification. The policy is DATA: the shipped rules
 * plus whatever a deployment adds, compiled once at load into anchored
 * tool-name matchers and case-insensitive command patterns, then applied to
 * one pending call at a time. Nothing here reaches a service, a session, or
 * the network — classification is a pure function, which is why it can be
 * pinned exhaustively by table.
 * @module @saturnai/dsh-gates/policy
 */

import z from '@deepseek-ai/schemastery'
import { DEFAULT_COMMAND_FIELDS, DEFAULT_ESCALATION_MODES, DEFAULT_ESCALATION_TOOLS, DEFAULT_RULES } from './roster.ts'
import type { GateAction, GateCall, GateClass, GateMatch, GateRule } from './types.ts'

/** Every {@link GateClass}, for runtime validation of a rule that bypassed the schema. */
const GATE_CLASSES: readonly GateClass[] = ['credentials', 'spend', 'publish', 'outbound', 'destructive', 'identity']

/** Every {@link GateAction}, for runtime validation of a rule that bypassed the schema. */
const GATE_ACTIONS: readonly GateAction[] = ['ask', 'deny']

/** Message prefix on every load-time failure, so a broken policy names itself. */
const PREFIX = 'saturn-gates'

/** Plugin config. All fields optional; `static Config` supplies the defaults. */
export interface Config {
  /** Keep the shipped rules (default `true`). `false` leaves only `rules`. */
  includeDefaults?: boolean
  /** Rules appended after the shipped ones, matched in the order given. */
  rules?: GateRule[]
  /** Ids of shipped rules to drop; an id that names no shipped rule fails at load. */
  disableRules?: string[]
  /** Tool-name patterns exempt from the `ask` rules. A `deny` rule is never exemptible. */
  allow?: string[]
  /** Argument fields a pattern rule reads, joined with newlines before matching. */
  commandFields?: string[]
  /**
   * Abstain on a shell call that already carries a `sandbox_permissions`
   * escalation (default `true`), because that call's own body resolves one
   * approval before it runs anything — see {@link CompiledPolicy}.
   */
  deferToSandboxEscalation?: boolean
  /** Tool-name patterns whose body resolves an escalation approval of its own. */
  escalationTools?: string[]
  /**
   * The sandbox modes an escalation may name for the deferral to apply
   * (default `workspace-write`, `danger-full-access`). A request outside this
   * vocabulary never reaches a human, so it does not excuse a Gate-class call.
   */
  escalationModes?: string[]
}

/** Schema for one rule inside {@link Config}. */
const GateRuleSchema: z<GateRule> = z.object({
  id: z.string().required(),
  class: z.union(['credentials', 'spend', 'publish', 'outbound', 'destructive', 'identity'] as const).required(),
  action: z.union(['ask', 'deny'] as const),
  tools: z.array(z.string()).default([]),
  pattern: z.string(),
  reason: z.string().required(),
})

/** Validated plugin config. */
export const Config: z<Config> = z.object({
  includeDefaults: z.boolean().default(true),
  rules: z.array(GateRuleSchema).default([]),
  disableRules: z.array(z.string()).default([]),
  allow: z.array(z.string()).default([]),
  commandFields: z.array(z.string()).default([...DEFAULT_COMMAND_FIELDS]),
  deferToSandboxEscalation: z.boolean().default(true),
  escalationTools: z.array(z.string()).default([...DEFAULT_ESCALATION_TOOLS]),
  escalationModes: z.array(z.string()).default([...DEFAULT_ESCALATION_MODES]),
})

/** One rule with its matchers compiled. */
interface CompiledRule {
  readonly rule: GateRule
  readonly action: GateAction
  readonly tools: readonly RegExp[]
  readonly pattern: RegExp | undefined
}

/**
 * A policy ready to classify calls. Built once per plugin load; every field is
 * frozen at that point, so classification never depends on config that changed
 * after the rules were validated.
 */
export interface CompiledPolicy {
  /** Rules in match order; the first match claims the call, a deny beats every ask. */
  readonly rules: readonly CompiledRule[]
  /** Tool-name matchers that exempt a call from the `ask` rules only. */
  readonly allow: readonly RegExp[]
  /** Argument fields a pattern rule reads. */
  readonly commandFields: readonly string[]
  /** Whether a call carrying its own escalation is left to that escalation's approval. */
  readonly deferToSandboxEscalation: boolean
  /** Tool-name matchers for the tools whose body resolves an escalation approval. */
  readonly escalationTools: readonly RegExp[]
  /** The sandbox modes an escalation may name for the deferral to apply. */
  readonly escalationModes: ReadonlySet<string>
}

/**
 * Compile one `*`-wildcard tool-name pattern to an anchored RegExp; every
 * other regular-expression metacharacter is matched literally, so a rule can
 * name `mcp__shop-ops__create_invoice` without escaping anything.
 * @param pattern - the wildcard pattern from a rule or from `allow`.
 * @returns the anchored matcher for one tool name.
 */
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
}

/**
 * Compile one rule, rejecting anything the schema cannot express: a class or
 * action outside the vocabulary, an empty tool list, an empty reason, or a
 * pattern the regular-expression engine will not accept. A policy that cannot
 * be compiled fails the plugin load rather than gating nothing.
 * @param rule - one rule from the shipped set or from config.
 * @returns the rule with its matchers compiled.
 */
function compileRule(rule: GateRule): CompiledRule {
  if (typeof rule.id !== 'string' || rule.id.trim().length === 0) {
    throw new TypeError(`${PREFIX}: every rule needs a non-empty id`)
  }
  if (!GATE_CLASSES.includes(rule.class)) {
    throw new TypeError(`${PREFIX}: rule "${rule.id}" names an unknown gate class ${JSON.stringify(rule.class)}`)
  }
  const action = rule.action ?? 'ask'
  if (!GATE_ACTIONS.includes(action)) {
    throw new TypeError(`${PREFIX}: rule "${rule.id}" names an unknown action ${JSON.stringify(rule.action)}`)
  }
  if (rule.tools.length === 0) {
    throw new TypeError(`${PREFIX}: rule "${rule.id}" needs at least one tool pattern`)
  }
  if (typeof rule.reason !== 'string' || rule.reason.trim().length === 0) {
    throw new TypeError(`${PREFIX}: rule "${rule.id}" needs a non-empty reason for the model to read`)
  }
  let pattern: RegExp | undefined
  if (rule.pattern !== undefined) {
    try {
      pattern = new RegExp(rule.pattern, 'i')
    } catch (error: unknown) {
      throw new TypeError(`${PREFIX}: rule "${rule.id}" has an invalid pattern: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { rule, action, tools: rule.tools.map(wildcardToRegExp), pattern }
}

/**
 * Build the policy one plugin instance applies. Fails loud on a malformed rule,
 * a duplicate id (two rules answering to one name make a disable or a report
 * ambiguous), a `disableRules` entry that names no shipped rule (usually a
 * typo that would silently leave the rule armed), or an empty field list.
 * @param config - the deployment's config; every field may be omitted.
 * @returns the compiled policy.
 */
export function compilePolicy(config: Config): CompiledPolicy {
  const includeDefaults = config.includeDefaults ?? true
  const disabled = config.disableRules ?? []
  const shippedIds = new Set(DEFAULT_RULES.map(rule => rule.id))
  for (const id of disabled) {
    if (!shippedIds.has(id)) {
      throw new TypeError(`${PREFIX}: disableRules names ${JSON.stringify(id)}, which is not a shipped rule`)
    }
  }
  const disabledSet = new Set(disabled)
  const selected: GateRule[] = [
    ...includeDefaults ? DEFAULT_RULES.filter(rule => !disabledSet.has(rule.id)) : [],
    ...config.rules ?? [],
  ]
  const seen = new Set<string>()
  const rules: CompiledRule[] = []
  for (const rule of selected) {
    const compiled = compileRule(rule)
    if (seen.has(rule.id)) {
      throw new TypeError(`${PREFIX}: duplicate rule id ${JSON.stringify(rule.id)}`)
    }
    seen.add(rule.id)
    rules.push(compiled)
  }
  const commandFields = config.commandFields ?? DEFAULT_COMMAND_FIELDS
  if (commandFields.length === 0 || commandFields.some(field => field.trim().length === 0)) {
    throw new TypeError(`${PREFIX}: commandFields must be a non-empty list of non-empty argument names`)
  }
  return {
    rules,
    allow: (config.allow ?? []).map(wildcardToRegExp),
    commandFields: [...commandFields],
    deferToSandboxEscalation: config.deferToSandboxEscalation ?? true,
    escalationTools: (config.escalationTools ?? DEFAULT_ESCALATION_TOOLS).map(wildcardToRegExp),
    escalationModes: new Set(config.escalationModes ?? DEFAULT_ESCALATION_MODES),
  }
}

/**
 * The text a pattern rule matches against: the configured argument fields that
 * hold a string, joined with newlines. Newlines are the separator because
 * every shipped pattern stays within one line, so two fields cannot be spliced
 * into a match neither one contains.
 * @param fields - the configured argument names, in order.
 * @param args - the call's parsed arguments, whatever shape they arrived in.
 * @returns the joined text, or the empty string when the call carries none.
 */
function inspectedText(fields: readonly string[], args: unknown): string {
  if (typeof args !== 'object' || args === null) return ''
  const record = args as Record<string, unknown>
  const parts: string[] = []
  for (const field of fields) {
    const value = record[field]
    if (typeof value === 'string') parts.push(value)
  }
  return parts.join('\n')
}

/**
 * Classify one pending call. A `deny` anywhere in the policy wins immediately;
 * otherwise the first matching rule's `ask` is returned. An unmatched call
 * returns `undefined`, which is the ordinary case and means the call is none
 * of the Gate's business.
 *
 * `allow` exempts a tool from the `ask` rules and ONLY from those. A `deny`
 * rule names an effect that takes the machine rather than the session, and a
 * deployment that adds `allow: ['bash']` to quiet noisy prompts is asking for
 * fewer questions, not for a disarmed fork bomb — so the exemption is applied
 * per rule instead of short-circuiting the scan.
 * @param policy - the compiled policy.
 * @param call - the pending call's name and arguments.
 * @returns the claiming rule's match, or `undefined` when nothing claims it.
 */
export function classify(policy: CompiledPolicy, call: GateCall): GateMatch | undefined {
  const exempt = policy.allow.some(matcher => matcher.test(call.name))
  let text: string | undefined
  let ask: GateMatch | undefined
  for (const compiled of policy.rules) {
    if (exempt && compiled.action !== 'deny') continue
    if (!compiled.tools.some(matcher => matcher.test(call.name))) continue
    if (compiled.pattern !== undefined) {
      text ??= inspectedText(policy.commandFields, call.arguments)
      if (!compiled.pattern.test(text)) continue
    }
    const match: GateMatch = {
      ruleId: compiled.rule.id,
      class: compiled.rule.class,
      action: compiled.action,
      reason: compiled.rule.reason,
    }
    if (match.action === 'deny') return match
    ask ??= match
  }
  return ask
}

/**
 * Whether this call already carries a sandbox escalation its own tool body
 * will resolve through the approval seam — the only condition under which the
 * Gate abstains from a call a rule claimed, so the test is deliberately narrow.
 *
 * Three things must hold, and each one is a way the claim can be false. The
 * tool must be one whose body actually resolves an escalation. The mode must
 * be one the sandbox family can be escalated TO: a request naming anything
 * else is refused by that family's widening check without a human seeing it,
 * so honouring it would let two invented arguments silence any `ask` rule.
 * And the justification must be there, because the escalating tools require it
 * and reject the call before running anything without it.
 * @param policy - the compiled policy.
 * @param call - the pending call's name and arguments.
 * @returns true when the call's own body will raise one approval for it.
 */
export function carriesSandboxEscalation(policy: CompiledPolicy, call: GateCall): boolean {
  if (!policy.escalationTools.some(matcher => matcher.test(call.name))) return false
  if (typeof call.arguments !== 'object' || call.arguments === null) return false
  const record = call.arguments as Record<string, unknown>
  const mode = record['sandbox_permissions']
  const justification = record['justification']
  return typeof mode === 'string' && policy.escalationModes.has(mode)
    && typeof justification === 'string' && justification.trim().length > 0
}
