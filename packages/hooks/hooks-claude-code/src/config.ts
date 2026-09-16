/**
 * Parse Claude Code's event-to-matcher-group hook format into shared {@link MatcherGroup}s, and the
 * Claude-name ↔ DSH-name tool alias table that lets an unmodified Claude Code matcher and payload
 * `tool_name` work against DSH's own tool names. Only command hooks on a supported event run; a
 * non-command hook and an entire unsupported top-level event are both returned as skipped so the
 * bridge can warn. Plugin-root and project-directory substitutions are applied to commands at parse
 * time.
 * @module @deepseek-ai/dsh-hooks-claude-code/config
 */

import { matcherDiagnostic, type MatcherGroup } from '@deepseek-ai/dsh-hook-protocol'

const CLAUDE_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStart',
  'SubagentStop',
] as const
const SUPPORTED_EVENTS: ReadonlySet<string> = new Set(CLAUDE_EVENTS)

/**
 * Every Claude Code hook-event name this bridge knows about, implemented or not: the seven
 * {@link CLAUDE_EVENTS} it runs, plus the 23 events the README's Known Limitations section
 * enumerates as unimplemented (`Setup` … `ElicitationResult`, `ConfigChange` and `PreCompact`
 * included). A settings file's own top-level keys (`model`, `permissions`, `env`, …) are NOT
 * Claude Code hook events and must never be recorded as `skipped` — only a key in this set can be
 * an "unsupported event" (see {@link parseClaudeCodeConfig}'s settings-file fallback).
 */
const KNOWN_UNIMPLEMENTED_CLAUDE_EVENTS = [
  'Setup',
  'InstructionsLoaded',
  'UserPromptExpansion',
  'MessageDisplay',
  'PermissionRequest',
  'PostToolUseFailure',
  'PostToolBatch',
  'PermissionDenied',
  'Notification',
  'TaskCreated',
  'TaskCompleted',
  'StopFailure',
  'TeammateIdle',
  'ConfigChange',
  'CwdChanged',
  'FileChanged',
  'WorktreeCreate',
  'WorktreeRemove',
  'PreCompact',
  'PostCompact',
  'SessionEnd',
  'Elicitation',
  'ElicitationResult',
] as const
const KNOWN_CLAUDE_EVENTS: ReadonlySet<string> = new Set([...CLAUDE_EVENTS, ...KNOWN_UNIMPLEMENTED_CLAUDE_EVENTS])

/** A parsed CC config: event name → its matcher groups (command hooks only). */
export type ClaudeCodeHookConfig = Record<string, MatcherGroup[]>

/**
 * A skipped hook or event, surfaced so the bridge can warn about it. `reason` is present for a
 * whole unsupported top-level event (`'unsupported event'`, `type` is the sentinel `'event'` since
 * its hooks were never inspected); absent for a skipped non-command hook within a supported event
 * (`type` is that hook's own `type`, e.g. `'prompt'`, `'http'`).
 */
export interface SkippedHook {
  event: string
  type: string
  reason?: string
}

/**
 * One Claude Code tool name mapped to the DSH tool names it aliases, in matcher/`tool_name`
 * precedence order (see {@link claudeToolName}).
 */
export type ToolAliases = Record<string, string[]>

/**
 * The reference tool alias table (INV-harness-tools.json + mars-gap-plan corrections 3-4): the DSH
 * tool inventory names its shell/fs/search tools differently than Claude Code's matcher and
 * `tool_name` vocabulary, so an unmodified `Bash|PowerShell` or `Edit|Write|MultiEdit` matcher never
 * fires against a DSH tool call, and a synthesised payload's `tool_name` never reads as the name a
 * hook script written for Claude Code expects. Key order is precedence order for
 * {@link claudeToolName} when more than one Claude name aliases the same DSH tool (e.g.
 * `str_replace_editor` under `Edit`, `MultiEdit`, and `NotebookEdit`).
 */
export const DEFAULT_TOOL_ALIASES: ToolAliases = {
  Bash: ['bash'],
  PowerShell: ['pwsh'],
  Write: ['write'],
  Edit: ['edit', 'str_replace_editor'],
  MultiEdit: ['edit', 'str_replace_editor'],
  NotebookEdit: ['edit', 'str_replace_editor'],
  Read: ['read', 'read_image'],
  Glob: ['glob'],
  Grep: ['grep'],
  WebFetch: ['web_fetch'],
  WebSearch: ['web_search'],
}

/**
 * Validate a configured `toolAliases` value: every key's value must be a non-empty array of
 * non-empty DSH tool name strings. Throws a `TypeError` naming the offending key, so a malformed
 * config is rejected at load rather than silently dropped or partially applied.
 * @param value - the raw configured `toolAliases` value (or `{}` when the caller has none).
 * @returns the value, unchanged, once every entry is confirmed well-formed.
 */
export function validateToolAliases(value: unknown): ToolAliases {
  const obj = asObject(value)
  if (!obj) {
    throw new TypeError('hooks-claude-code: toolAliases must be an object mapping Claude Code tool names to arrays of DSH tool names')
  }
  const result: ToolAliases = {}
  for (const [claudeName, dshNames] of Object.entries(obj)) {
    if (!Array.isArray(dshNames) || dshNames.length === 0 || !dshNames.every((n): n is string => typeof n === 'string' && n.length > 0)) {
      throw new TypeError(`hooks-claude-code: toolAliases.${claudeName} must be a non-empty array of non-empty DSH tool name strings`)
    }
    result[claudeName] = dshNames
  }
  return result
}

/**
 * Build the DSH-name → Claude-names reverse index a bridge evaluates matchers and payload
 * `tool_name` against. A DSH name's Claude names keep {@link ToolAliases} key order (its
 * precedence order).
 */
export function reverseToolAliases(aliases: ToolAliases): Map<string, string[]> {
  const reverse = new Map<string, string[]>()
  for (const [claudeName, dshNames] of Object.entries(aliases)) {
    for (const dshName of dshNames) {
      const existing = reverse.get(dshName)
      if (existing) existing.push(claudeName)
      else reverse.set(dshName, [claudeName])
    }
  }
  return reverse
}

/**
 * Every matcher subject a DSH tool call may be selected under: its own raw DSH name, plus every
 * Claude name aliasing it (empty when nothing does). A `PreToolUse`/`PostToolUse` matcher group
 * fires when ANY of these matches, so an unmodified Claude Code `hooks.json` matcher (`Bash`) and a
 * DSH-native one (`bash`) both work.
 */
export function toolMatchCandidates(dshName: string, reverse: ReadonlyMap<string, string[]>): string[] {
  return [dshName, ...reverse.get(dshName) ?? []]
}

/**
 * The `tool_name` a synthesised payload reports for a DSH tool call: the first (precedence-order)
 * Claude name aliasing it, else the raw DSH name unchanged.
 */
export function claudeToolName(dshName: string, reverse: ReadonlyMap<string, string[]>): string {
  return reverse.get(dshName)?.[0] ?? dshName
}

/** The outcome of parsing one config file: the runnable groups + what was skipped. */
export interface ParsedClaudeConfig {
  config: ClaudeCodeHookConfig
  skipped: SkippedHook[]
}

/** Substitution variables applied to each `command` string at parse time. */
export interface SubstitutionVars {
  /** Replaces `${CLAUDE_PLUGIN_ROOT}` — the plugin's root dir. */
  pluginRoot?: string
  /** Replaces `${CLAUDE_PROJECT_DIR}` — the project root. */
  projectDir?: string
}

/** A plain (non-null, non-array) object, else undefined. */
function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Apply `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PROJECT_DIR}` substitution to a command string.
 * @param command - the raw command from config.
 * @param vars - the substitution values; a token whose variable is unset stays verbatim.
 * @returns the command with every occurrence of each set token replaced.
 */
export function substituteCommand(command: string, vars: SubstitutionVars): string {
  let out = command
  if (vars.pluginRoot !== undefined) out = out.split('${CLAUDE_PLUGIN_ROOT}').join(vars.pluginRoot)
  if (vars.projectDir !== undefined) out = out.split('${CLAUDE_PROJECT_DIR}').join(vars.projectDir)
  return out
}

/**
 * Parse either a settings `hooks` value or a bare `hooks.json` event map. Malformed entries are
 * ignored rather than failing boot; an unsupported top-level event key (e.g. `ConfigChange`,
 * `PreCompact`) is recorded in `skipped` with reason `'unsupported event'` — its hooks are never
 * inspected, so it cannot invalidate or register anything, but the bridge warns about it — and a
 * non-command hook within a supported event is likewise returned in `skipped`. Substitutions are
 * applied to every surviving command. Matcher fields on UserPromptSubmit and Stop are discarded
 * because those events have no matcher subject. A matcher-bearing supported runnable group with an
 * invalid regex throws a `SyntaxError`, allowing the bridge to reject the complete config before
 * listener registration.
 *
 * @param raw - the parsed JSON config: a settings object with a `hooks` key, or the bare
 *   event map.
 * @param vars - substitution values applied to every surviving `command` (defaults to
 *   none).
 * @returns the runnable per-event groups plus the skipped hooks/events.
 */
export function parseClaudeCodeConfig(raw: unknown, vars: SubstitutionVars = {}): ParsedClaudeConfig {
  const config: ClaudeCodeHookConfig = {}
  const skipped: SkippedHook[] = []
  // Accept either `{ hooks: { … } }` (a settings file) or the bare event map.
  const root = asObject(raw)
  const hooksMap = root ? asObject(root.hooks) ?? root : undefined
  if (!hooksMap) return { config, skipped }

  for (const event of Object.keys(hooksMap)) {
    if (!SUPPORTED_EVENTS.has(event)) {
      // Only a key this bridge recognizes as an actual Claude Code hook-event name is worth a
      // warning; an ordinary settings-file key (`model`, `permissions`, `env`, …) reaching this
      // loop through the bare-root fallback above is not an event at all and must stay silent.
      if (KNOWN_CLAUDE_EVENTS.has(event)) {
        skipped.push({ event, type: 'event', reason: 'unsupported event' })
      }
      continue
    }
    const rawGroups = hooksMap[event]
    if (!Array.isArray(rawGroups)) continue
    const groups: MatcherGroup[] = []
    for (const rawGroup of rawGroups) {
      const group = asObject(rawGroup)
      if (!group || !Array.isArray(group.hooks)) continue
      const commands: MatcherGroup['hooks'] = []
      for (const rawHook of group.hooks) {
        const hook = asObject(rawHook)
        if (!hook) continue
        const type = typeof hook.type === 'string' ? hook.type : 'command'
        if (type !== 'command') {
          skipped.push({ event, type })
          continue
        }
        if (typeof hook.command !== 'string') continue
        commands.push({
          command: substituteCommand(hook.command, vars),
          ...typeof hook.timeout === 'number' ? { timeoutSec: hook.timeout } : {},
        })
      }
      if (commands.length === 0) continue
      const matcher = event === 'UserPromptSubmit' || event === 'Stop'
        ? undefined
        : typeof group.matcher === 'string' ? group.matcher : undefined
      const diagnostic = matcherDiagnostic(matcher, 'claude-code')
      if (diagnostic !== undefined) throw new SyntaxError(`${diagnostic} on event ${JSON.stringify(event)}`)
      groups.push({
        ...matcher !== undefined ? { matcher } : {},
        hooks: commands,
      })
    }
    if (groups.length > 0) config[event] = groups
  }

  return { config, skipped }
}
