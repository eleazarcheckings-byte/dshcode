/**
 * Bridge for unmodified Claude Code command hooks on harness interception
 * extension points. It supports SessionStart, prompt/tool pre/post, Stop, and subagent
 * start/stop. It owns Claude payloads, environment, substitution, and decision
 * mapping; shared execution and parsing live in `dsh-hook-protocol`.
 * `updatedInput` is logged and warned but not honored. Bespoke behavior should
 * use typed native plugins on the same extension points; see the
 * [hook-bridges Agent Note](../../../../.agents/notes/implemented/feature/2026-06-30-hook-bridges.md).
 * @module @deepseek-ai/dsh-hooks-claude-code
 */

import { readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision, TurnBoundaryProjection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, MessageSource } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { PostToolDecision, PreToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import {
  appendHookInvoked,
  appendHookResult,
  createDetachedRuns,
  DEFAULT_HOOK_TIMEOUT_MS,
  DEFAULT_STDERR_SUMMARY_MAX_CHARS,
  matchesMatcher,
  mergeHookOutputs,
  runHook,
  type HookOutput,
  type MatcherGroup,
  type MergedHookOutcome,
} from '@deepseek-ai/dsh-hook-protocol'
// Pulls in the declaration-merged subagent events and the identity pairing their
// start/end edges.
import type { SubagentRunId } from '@deepseek-ai/dsh-subagent'
import {
  claudeToolName,
  DEFAULT_TOOL_ALIASES,
  parseClaudeCodeConfig,
  reverseToolAliases,
  toolMatchCandidates,
  validateToolAliases,
  type ClaudeCodeHookConfig,
  type ToolAliases,
} from './config.ts'

export const name = 'hooks-claude-code'
// `shell` runs hooks and `sessionProjections` supplies turn numbers; the rest
// are read opportunistically via ctx.get so a deployment can omit them.
export const inject = ['shell', 'sessionProjections']

/** Plugin config: where the CC hook config lives + substitution roots. */
export interface Config {
  /**
   * Path to a `hooks.json` or a settings file whose `hooks` key holds the config.
   * Process-level: read once at load, a relative path resolves against the process
   * launch cwd, so one config applies to the whole process.
   * TODO(per-session-hook-config): per-session discovery of a project-local
   * `hooks.json` from each `session/new.cwd`.
   */
  configPath: string
  /**
   * Replaces `${CLAUDE_PLUGIN_ROOT}` in command strings (the plugin's root dir).
   */
  pluginRoot?: string
  /**
   * Replaces `${CLAUDE_PROJECT_DIR}` in command strings AND is exported as the
   * `CLAUDE_PROJECT_DIR` env var for hook processes. When omitted, the env var
   * defaults per-run to the agent's session workspace (`session.header.cwd`, the
   * same dir the hook runs in) — Claude Code always exports this var, and common
   * unmodified hooks reference `$CLAUDE_PROJECT_DIR` for project-relative paths.
   */
  projectDir?: string
  /** Default per-hook timeout in ms when a hook sets none (CC default: 600000). */
  defaultTimeoutMs?: number
  /** Character cap for the `hook/result` event's persisted stderr summary. */
  stderrSummaryMaxChars?: number
  /**
   * Claude Code tool name → the DSH tool names it aliases (e.g. `Bash: ['bash']`,
   * `Edit: ['edit', 'str_replace_editor']`). A `PreToolUse`/`PostToolUse` matcher evaluates
   * against both the raw DSH tool name and every configured Claude name aliasing it, and a
   * synthesised payload's `tool_name` reports the first (key-order) aliasing Claude name, else the
   * raw DSH name. A configured entry REPLACES the default of the same Claude name; every other
   * default entry (`DEFAULT_TOOL_ALIASES`) is kept. Rejected at load when a value is not an object
   * of non-empty string arrays.
   */
  toolAliases?: ToolAliases
}

export const Config: z<Config> = z.object({
  configPath: z.string().required(),
  pluginRoot: z.string(),
  projectDir: z.string(),
  defaultTimeoutMs: z.number().default(DEFAULT_HOOK_TIMEOUT_MS),
  stderrSummaryMaxChars: z.number().default(DEFAULT_STDERR_SUMMARY_MAX_CHARS),
  // Loosely typed here: `apply()` runs the authoritative validation (`validateToolAliases`) so the
  // rejection message is stable and identical whether the plugin is mounted through schemastery or
  // called directly (the "schema bypass" apply() path the coverage suite exercises).
  toolAliases: z.any(),
})

/** A stable per-handler id so an invoked/result pair correlates in the log. */
let handlerCounter = 0
function nextHandlerId(point: string): string {
  return `claude-code:${point}:${++handlerCounter}`
}

/** The `{kind:'plugin'}` source stamped on every context this bridge injects. */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'hooks-claude-code' }

/** The summary cap bounds a persisted event field — a positive integer or the slice misbehaves silently. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`hooks-claude-code: ${name} must be a positive integer`)
  }
}

export function apply(ctx: Context, config: Config): void {
  // Validate before config parsing so a bad value cannot be hidden by its early return.
  const stderrSummaryMaxChars = config.stderrSummaryMaxChars ?? DEFAULT_STDERR_SUMMARY_MAX_CHARS
  assertPositiveInteger('stderrSummaryMaxChars', stderrSummaryMaxChars)
  const defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS
  // A configured entry replaces the default of the same Claude name; every other default is kept.
  // validateToolAliases throws (naming the offending key) on a malformed value, rejecting the whole
  // plugin load rather than silently dropping or partially applying it.
  const toolAliases: ToolAliases = { ...DEFAULT_TOOL_ALIASES, ...validateToolAliases(config.toolAliases ?? {}) }
  const reverseAliases = reverseToolAliases(toolAliases)
  // Parse once at load. A read or parse failure logs and registers nothing.
  let parsed: ClaudeCodeHookConfig = {}
  try {
    const raw: unknown = JSON.parse(readFileSync(config.configPath, 'utf8'))
    const result = parseClaudeCodeConfig(raw, {
      ...config.pluginRoot !== undefined ? { pluginRoot: config.pluginRoot } : {},
      ...config.projectDir !== undefined ? { projectDir: config.projectDir } : {},
    })
    parsed = result.config
    for (const s of result.skipped) {
      ctx.logger.warn(s.reason === 'unsupported event'
        ? `hooks-claude-code: skipping unsupported event "${s.event}" (${s.reason} — this bridge does not implement it)`
        : `hooks-claude-code: skipping unsupported "${s.type}" hook on ${s.event} (only command hooks run)`)
    }
  } catch (error: unknown) {
    ctx.logger.warn(`hooks-claude-code: could not load hook config "${config.configPath}": ${String(error)} — no hooks registered`)
    return
  }

  // Emit-shaped points run detached, so track their chains; disposal aborts
  // active hooks and drains continuations before resolving.
  const detached = createDetachedRuns()
  // Only the start edge guarantees registry access. Retain each local child
  // through its paired end so stop hooks keep the session workspace after the
  // handle unregisters the agent. Every retained entry relies on that paired
  // end; a producer that can omit it must provide another release edge.
  const subagentChildren = new Map<SubagentRunId, Agent>()
  ctx.effect(() => () => detached.drain(), 'hooks-claude-code: drain detached hook runs')

  /**
   * Run every command hook configured for `point` whose matcher selects ANY of
   * `matchCandidates`, with the per-event `payload` on stdin, and fold the results.
   * Writes a `hook/invoked`/`hook/result` pair per hook when `opts.turn` names
   * an open turn. Detached lifecycle points omit the pair. Returns the merged outcome (a neutral,
   * already-most-restrictive view) for the caller to map onto its extension point
   * decision. `matchCandidates` are the event's matcher subject candidates (a tool call's raw DSH
   * name plus every Claude name aliasing it, a session source, …) — `['']` for events that ignore
   * matchers.
   */
  async function runPoint(
    point: string,
    matchCandidates: readonly string[],
    payload: unknown,
    opts: { agent?: Agent; turn?: number; readonly signal: AbortSignal },
  ): Promise<MergedHookOutcome> {
    const groups: MatcherGroup[] = parsed[point] ?? []
    const outputs: HookOutput[] = []
    // Run the hook in the agent's session workspace (the `session/new` cwd on the session
    // header), not the executor or entry-point process's launch dir.
    const workdir = opts.agent?.session.header.cwd
    // CLAUDE_PROJECT_DIR: an explicit config value wins; otherwise default it to the session
    // workspace (the same dir the hook runs in).
    const projectDir = config.projectDir ?? workdir
    const hookEnv = projectDir !== undefined ? { CLAUDE_PROJECT_DIR: projectDir } : undefined
    for (const group of groups) {
      if (!matchCandidates.some(candidate => matchesMatcher(group.matcher, candidate, 'claude-code'))) continue
      for (const hook of group.hooks) {
        const handlerId = nextHandlerId(point)
        const session = opts.agent?.session
        if (session && opts.turn !== undefined) {
          appendHookInvoked(session, {
            turn: opts.turn, point, dialect: 'claude-code', handlerId,
            ...group.matcher !== undefined ? { matcher: group.matcher } : {},
          })
        }
        const { output, durationMs } = await runHook(ctx.shell, hook, {
          payload,
          defaultTimeoutMs,
          ...hookEnv ? { env: hookEnv } : {},
          ...workdir !== undefined ? { cwd: workdir } : {},
          signal: opts.signal,
          trailingNewline: true,
          // Discard a `hookSpecificOutput` block whose `hookEventName` names a
          // different event than the one firing (the schemas key it by event).
          expectedEventName: point,
        }, () => performance.now())
        outputs.push(output)
        if (output.updatedInput !== undefined) {
          ctx.logger.warn(`hooks-claude-code: ${point} hook requested updatedInput, which is not yet honored (ignored)`)
        }
        if (output.systemMessage !== undefined) {
          ctx.logger.warn(`hooks-claude-code: ${point} hook emitted a systemMessage, which is not yet surfaced (ignored)`)
        }
        if (session && opts.turn !== undefined) {
          appendHookResult(session, { turn: opts.turn, point, handlerId, output, stderrSummaryMaxChars, durationMs })
        }
      }
    }
    return mergeHookOutputs(outputs)
  }

  // TODO(hook-continue-false): `merged.stop` is logged but needs a run-level halt mechanism.

  /** Build additional model context from hook output, or return undefined when empty. */
  function contextFrom(merged: MergedHookOutcome): UserMessage | undefined {
    if (merged.additionalContext.length === 0) return undefined
    const content: ContentBlock[] = merged.additionalContext.map(text => ({ type: 'text', text }))
    return createUserMessage({ content, source: PLUGIN_SOURCE })
  }

  /** Prepend one context without flattening source fields or other downstream metadata. */
  function prependContext(ours: UserMessage, theirs: UserMessage[] | undefined): UserMessage[] {
    return [ours, ...theirs ?? []]
  }

  // SessionStart injects context when its detached hook resolves; a slow hook
  // may miss the first request.
  // TODO(session-start-gating): add a startup gate before promising first-turn delivery.
  ctx.on('agent/session-start', ({ agent, source }) => {
    detached.track(runPoint('SessionStart', [source], sessionStartPayload(ctx, agent, source), { agent, signal: detached.signal })
      .then((merged) => {
        const context = contextFrom(merged)
        if (context) agent.inject(context)
      })
      .catch((error: unknown) => {
        ctx.logger.warn(`hooks-claude-code: SessionStart hook failed: ${String(error)}`)
      }))
  })

  // --- UserPromptSubmit → PreStepDecision. The prompt text is the payload; no
  // matcher subject (CC ignores matchers for this event). ---
  ctx.on('agent/pre-step', async ({ agent, messages, turn, signal }, next): Promise<PreStepDecision> => {
    if (messages.length === 0) return next()
    const content = messages.flatMap(message => message.content)
    const merged = await runPoint('UserPromptSubmit', [''], promptPayload(ctx, agent, content), { agent, turn, signal })
    if (merged.decision === 'deny') {
      return { kind: 'reject' }
    }
    // Delegate so later listeners may still rewrite or reject, then prepend our
    // context only to a downstream enter decision.
    const downstream = await next()
    const ours = contextFrom(merged)
    if (!ours || downstream.kind !== 'enter') return downstream
    return {
      ...downstream,
      messages: [...downstream.messages, ours],
    }
  })

  // --- PreToolUse → PreToolDecision. Matcher subject is the tool name — the raw DSH name
  // plus every Claude name aliasing it (toolAliases), so an unmodified Claude Code matcher
  // (`Bash`) fires against the DSH tool call (`bash`) just as a DSH-native matcher would. ---
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const turn = lastTurn(ctx, exec.agent)
    const candidates = toolMatchCandidates(exec.name, reverseAliases)
    const toolName = claudeToolName(exec.name, reverseAliases)
    const merged = await runPoint('PreToolUse', candidates, preToolPayload(ctx, exec, toolName), { ...exec.agent ? { agent: exec.agent } : {}, turn, signal: exec.signal })
    if (merged.decision === 'deny') return { kind: 'deny', reason: merged.reason ?? 'blocked by PreToolUse hook' }
    if (merged.decision === 'ask') return { kind: 'ask', ...merged.reason !== undefined ? { reason: merged.reason } : {} }
    return next()
  })

  // --- PostToolUse → PostToolDecision. Matcher subject is the tool name (see PreToolUse above). ---
  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const turn = lastTurn(ctx, exec.agent)
    const candidates = toolMatchCandidates(exec.name, reverseAliases)
    const toolName = claudeToolName(exec.name, reverseAliases)
    const merged = await runPoint('PostToolUse', candidates, postToolPayload(ctx, exec, result, toolName), { ...exec.agent ? { agent: exec.agent } : {}, turn, signal: exec.signal })
    const context = contextFrom(merged)
    if (merged.decision === 'deny') {
      return { kind: 'block', feedback: [{ type: 'text', text: merged.reason ?? 'blocked by PostToolUse hook' }], ...context ? { additionalContexts: [context] } : {} }
    }
    // Our hooks did not block. DELEGATE so a later listener can still block/replace,
    // then fold our context onto its decision (a downstream block carries it too).
    const downstream = await next()
    if (!context) return downstream
    if (downstream.kind === 'block') {
      return { ...downstream, additionalContexts: prependContext(context, downstream.additionalContexts) }
    }
    return {
      ...downstream,
      additionalContexts: prependContext(context, downstream.additionalContexts),
    }
  })

  // A blocking Stop hook steers at the stopping boundary, which makes the
  // machine observe pending input and run another step.
  // TODO(stop-loop-guard): cap consecutive forced continuations; hooks must self-limit meanwhile.
  ctx.on('agent/turn-stopping', async ({ agent, turn, signal }): Promise<void> => {
    const merged = await runPoint('Stop', [''], stopPayload(ctx, agent), { agent, turn, signal })
    if (merged.decision === 'deny') {
      // A blocking Stop hook forces continuation.
      const text = merged.reason ?? 'continue: blocked by Stop hook'
      agent.steer(createUserMessage({ content: [{ type: 'text', text }], source: PLUGIN_SOURCE }))
    }
  })

  // SubagentStart may inject child context; SubagentStop only observes. Both
  // use the live child's workspace and the generic agent-type matcher subject.
  ctx.on('subagent/start', (info) => {
    const child = ctx.get('agents')?.get(info.id)
    if (child !== undefined) subagentChildren.set(info.runId, child)
    detached.track(runPoint('SubagentStart', [SUBAGENT_TYPE], subagentPayload(ctx, 'SubagentStart', info, child), { ...child ? { agent: child } : {}, signal: detached.signal })
      .then((merged) => {
        const context = contextFrom(merged)
        if (context && child) child.inject(context)
      })
      .catch((error: unknown) => { ctx.logger.warn(`hooks-claude-code: SubagentStart hook failed: ${String(error)}`) }))
  })
  ctx.on('subagent/end', (info) => {
    const child = subagentChildren.get(info.runId) ?? ctx.get('agents')?.get(info.id)
    subagentChildren.delete(info.runId)
    detached.track(runPoint('SubagentStop', [SUBAGENT_TYPE], subagentPayload(ctx, 'SubagentStop', info, child), { ...child ? { agent: child } : {}, signal: detached.signal }))
  })
}

/**
 * The `agent_type` value the bridge reports for SubagentStart/Stop. The harness
 * subagent seam carries no per-kind label, so the bridge uses Claude Code's own
 * Task-tool default — a hooks.json with a default/`*`/empty `agent_type` matcher
 * fires; a config matching a specific kind (e.g. `code-reviewer`) does not.
 */
const SUBAGENT_TYPE = 'general-purpose'

// --- Per-event stdin payloads (the CC DIALECT shape). Field names match CC's
// hook input schema; this is the part a bridge owns. ---

/** The last open turn number in the agent's log, or 0 without an agent. */
function lastTurn(ctx: Context, agent: Agent | undefined): number {
  if (!agent) return 0
  const boundary = ctx.sessionProjections.stateOf(agent.session, 'turnBoundary') as TurnBoundaryProjection
  return boundary.lastTurn
}

/** Flatten content blocks to the text a hook payload carries (the common case). */
function blocksToText(content: ContentBlock[]): string {
  return content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map(b => b.text).join('')
}

function base(ctx: Context, agent: Agent | undefined, event: string): Record<string, unknown> {
  return {
    session_id: agent?.session.header.id ?? '',
    transcript_path: agent === undefined
      ? ''
      : ctx.get('sessionPersistence')?.locate(agent.session.header)?.path ?? '',
    cwd: agent?.session.header.cwd ?? process.cwd(),
    hook_event_name: event,
  }
}

function sessionStartPayload(ctx: Context, agent: Agent, source: string): Record<string, unknown> {
  return { ...base(ctx, agent, 'SessionStart'), source }
}
function promptPayload(ctx: Context, agent: Agent, content: ContentBlock[]): Record<string, unknown> {
  return { ...base(ctx, agent, 'UserPromptSubmit'), prompt: blocksToText(content) }
}
/**
 * `tool_name` is the CALLER-RESOLVED Claude-facing name ({@link claudeToolName} against
 * `toolAliases`, else the raw DSH name) — not `exec.name` — so a hook script written against
 * Claude Code's `Bash`/`Edit`/… reads `tool_name` the way it expects. `tool_input` is
 * `exec.arguments` unchanged: the DSH bash/pwsh/write/edit tools already name their fields
 * (`command`, `file_path`, `content`, `old_string`, `new_string`, …) identically to Claude Code's
 * own tool schemas, so no field renaming is needed here.
 */
function preToolPayload(ctx: Context, exec: ToolExecution, toolName: string): Record<string, unknown> {
  return { ...base(ctx, exec.agent, 'PreToolUse'), tool_name: toolName, tool_input: exec.arguments, tool_use_id: exec.callId }
}
function postToolPayload(ctx: Context, exec: ToolExecution, result: ToolExecutionResult, toolName: string): Record<string, unknown> {
  return { ...base(ctx, exec.agent, 'PostToolUse'), tool_name: toolName, tool_input: exec.arguments, tool_use_id: exec.callId, tool_response: blocksToText(result.content) }
}
function stopPayload(ctx: Context, agent: Agent): Record<string, unknown> {
  return { ...base(ctx, agent, 'Stop'), stop_hook_active: false }
}
/**
 * Build a SubagentStart/SubagentStop payload from the CC base (the child's
 * `session_id`/`cwd` when the child agent is available) plus the subagent-hook
 * fields. `agent_type` is the CC-default {@link SUBAGENT_TYPE}; `stop_hook_active`
 * is present on SubagentStop only (the loop-guard flag, always false).
 */
function subagentPayload(ctx: Context, event: 'SubagentStart' | 'SubagentStop', info: { id: string }, child: Agent | undefined): Record<string, unknown> {
  return {
    ...base(ctx, child, event),
    agent_id: info.id,
    agent_type: SUBAGENT_TYPE,
    ...event === 'SubagentStop' ? { stop_hook_active: false } : {},
  }
}
