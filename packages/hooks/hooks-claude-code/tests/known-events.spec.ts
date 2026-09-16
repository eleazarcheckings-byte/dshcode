import { describe, expect, it } from 'vitest'
import { parseClaudeCodeConfig } from '@deepseek-ai/dsh-hooks-claude-code/src/config.ts'

/**
 * Regression coverage for Mars fix-round-1 finding (config.ts:184): when `parseClaudeCodeConfig`
 * is given a settings file with no `hooks` key, `hooksMap` falls back to the bare root
 * (`asObject(root.hooks) ?? root`), so every ordinary settings key (`model`, `permissions`, `env`,
 * …) is visited by the same loop that records unsupported *events*. Iterating the config's own
 * keys (this cell's fix for "ConfigChange/PreCompact are silently dropped before the loop even
 * sees them") must not regress this fallback path into treating `model`/`permissions`/`env` as
 * unsupported Claude Code hook events — that would drown the genuine signal (a real unsupported
 * event like `ConfigChange`) in noise for exactly the config shape this bridge advertises support
 * for: a full Claude Code settings file passed directly as `configPath`.
 */
describe('parseClaudeCodeConfig — settings-file fallback does not misclassify non-event keys', () => {
  it('does not record ordinary settings keys (model, permissions, env) as skipped/unsupported-event', () => {
    const { config, skipped } = parseClaudeCodeConfig({
      model: 'claude-sonnet-5',
      permissions: { allow: ['Bash(git *)'] },
      env: { FOO: 'bar' },
      PreToolUse: [{ hooks: [{ type: 'command', command: 'kept.sh' }] }],
    })
    expect(config).toEqual({ PreToolUse: [{ hooks: [{ command: 'kept.sh' }] }] })
    expect(skipped.some(s => s.event === 'model')).toBe(false)
    expect(skipped.some(s => s.event === 'permissions')).toBe(false)
    expect(skipped.some(s => s.event === 'env')).toBe(false)
  })

  it('still records a known-but-unimplemented Claude Code event (ConfigChange, PreCompact) as skipped in that same bare-root settings shape', () => {
    const { skipped } = parseClaudeCodeConfig({
      model: 'claude-sonnet-5',
      permissions: {},
      ConfigChange: [{ hooks: [{ type: 'command', command: 'a.sh' }] }],
      PreCompact: [{ hooks: [{ type: 'command', command: 'b.sh' }] }],
    })
    expect(skipped).toContainEqual({ event: 'ConfigChange', type: 'event', reason: 'unsupported event' })
    expect(skipped).toContainEqual({ event: 'PreCompact', type: 'event', reason: 'unsupported event' })
    expect(skipped.some(s => s.event === 'model' || s.event === 'permissions')).toBe(false)
  })
})
