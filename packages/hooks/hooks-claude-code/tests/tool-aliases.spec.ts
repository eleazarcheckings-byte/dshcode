import { describe, expect, it } from 'vitest'
import {
  claudeToolName,
  DEFAULT_TOOL_ALIASES,
  parseClaudeCodeConfig,
  reverseToolAliases,
  toolMatchCandidates,
  validateToolAliases,
} from '@deepseek-ai/dsh-hooks-claude-code/src/config.ts'

/**
 * Unit coverage for the toolAliases layer (INV-harness-tools.json + mars-gap-plan corrections 3-4):
 * the DSH tool inventory names its tools differently than Claude Code's matcher/tool_name vocabulary
 * (`bash` vs `Bash`, `edit`/`str_replace_editor` vs `Edit`), so an unmodified Claude Code hooks.json
 * matcher never fires without this reverse-alias layer. Full-loop matcher + payload assertions live
 * in `tool-alias-bridge.spec.ts`; this file covers the pure functions in isolation.
 */

describe('DEFAULT_TOOL_ALIASES + reverseToolAliases', () => {
  it('reverses the default table: a DSH name lists every aliasing Claude name in table precedence order', () => {
    const reverse = reverseToolAliases(DEFAULT_TOOL_ALIASES)
    expect(reverse.get('bash')).toEqual(['Bash'])
    expect(reverse.get('pwsh')).toEqual(['PowerShell'])
    expect(reverse.get('write')).toEqual(['Write'])
    expect(reverse.get('edit')).toEqual(['Edit', 'MultiEdit', 'NotebookEdit'])
    expect(reverse.get('str_replace_editor')).toEqual(['Edit', 'MultiEdit', 'NotebookEdit'])
    expect(reverse.get('read')).toEqual(['Read'])
    expect(reverse.get('read_image')).toEqual(['Read'])
    expect(reverse.get('glob')).toEqual(['Glob'])
    expect(reverse.get('grep')).toEqual(['Grep'])
    expect(reverse.get('web_fetch')).toEqual(['WebFetch'])
    expect(reverse.get('web_search')).toEqual(['WebSearch'])
    expect(reverse.get('unknown-dsh-tool')).toBeUndefined()
  })
})

describe('claudeToolName', () => {
  it('picks the first (table-precedence) aliasing Claude name for a DSH tool with multiple aliases', () => {
    const reverse = reverseToolAliases(DEFAULT_TOOL_ALIASES)
    expect(claudeToolName('bash', reverse)).toBe('Bash')
    expect(claudeToolName('edit', reverse)).toBe('Edit')
    expect(claudeToolName('str_replace_editor', reverse)).toBe('Edit')
  })
  it('falls back to the raw DSH name when no Claude alias covers it', () => {
    const reverse = reverseToolAliases(DEFAULT_TOOL_ALIASES)
    expect(claudeToolName('mcp__foo__bar', reverse)).toBe('mcp__foo__bar')
    expect(claudeToolName('terminal_open', reverse)).toBe('terminal_open')
  })
})

describe('toolMatchCandidates', () => {
  it('returns the raw DSH name plus every aliasing Claude name, DSH name first', () => {
    const reverse = reverseToolAliases(DEFAULT_TOOL_ALIASES)
    expect(toolMatchCandidates('bash', reverse)).toEqual(['bash', 'Bash'])
    expect(toolMatchCandidates('edit', reverse)).toEqual(['edit', 'Edit', 'MultiEdit', 'NotebookEdit'])
    expect(toolMatchCandidates('glob', reverse)).toEqual(['glob', 'Glob'])
  })
  it('returns just the DSH name when nothing aliases it', () => {
    const reverse = reverseToolAliases(DEFAULT_TOOL_ALIASES)
    expect(toolMatchCandidates('terminal_open', reverse)).toEqual(['terminal_open'])
  })
})

describe('validateToolAliases', () => {
  it('accepts and returns a well-formed table unchanged', () => {
    expect(validateToolAliases({ Bash: ['bash'] })).toEqual({ Bash: ['bash'] })
  })
  it('rejects a non-object value (string, null, array)', () => {
    expect(() => validateToolAliases('nope')).toThrow('hooks-claude-code: toolAliases must be an object')
    expect(() => validateToolAliases(null)).toThrow('hooks-claude-code: toolAliases must be an object')
    expect(() => validateToolAliases([1, 2])).toThrow('hooks-claude-code: toolAliases must be an object')
  })
  it('rejects a key whose value is not a non-empty array of non-empty strings, naming the key', () => {
    expect(() => validateToolAliases({ Bash: 'bash' })).toThrow('hooks-claude-code: toolAliases.Bash must be a non-empty array')
    expect(() => validateToolAliases({ Bash: [] })).toThrow('hooks-claude-code: toolAliases.Bash must be a non-empty array')
    expect(() => validateToolAliases({ Bash: [1] })).toThrow('hooks-claude-code: toolAliases.Bash must be a non-empty array')
    expect(() => validateToolAliases({ Bash: [''] })).toThrow('hooks-claude-code: toolAliases.Bash must be a non-empty array')
  })
})

describe('parseClaudeCodeConfig — unsupported top-level events', () => {
  it('records ConfigChange and PreCompact as skipped with reason "unsupported event", keeping supported hooks', () => {
    const { config, skipped } = parseClaudeCodeConfig({
      ConfigChange: [{ hooks: [{ type: 'command', command: 'a.sh' }] }],
      PreCompact: [{ hooks: [{ type: 'command', command: 'b.sh' }] }],
      PreToolUse: [{ hooks: [{ type: 'command', command: 'kept.sh' }] }],
    })
    expect(config).toEqual({ PreToolUse: [{ hooks: [{ command: 'kept.sh' }] }] })
    expect(skipped).toContainEqual({ event: 'ConfigChange', type: 'event', reason: 'unsupported event' })
    expect(skipped).toContainEqual({ event: 'PreCompact', type: 'event', reason: 'unsupported event' })
  })

  it('does not record a supported event as skipped even when it registers no runnable groups', () => {
    const { skipped } = parseClaudeCodeConfig({ PreToolUse: [{ hooks: [{ type: 'prompt', prompt: 'x' }] }] })
    expect(skipped.some(s => s.event === 'PreToolUse' && s.reason === 'unsupported event')).toBe(false)
  })
})
