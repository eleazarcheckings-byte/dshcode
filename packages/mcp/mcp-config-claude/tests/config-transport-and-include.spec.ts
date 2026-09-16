/**
 * New specs added in the fix round after tests/config.spec.ts's own RED
 * commit (noted in the fix-round report, per repo rules on RED specs) —
 * cover two Mars findings on `planOneRow`'s transport inference and
 * `planMounts`'s include-list semantics that the original RED specs did not
 * exercise.
 */
import { describe, expect, it } from 'vitest'
import { planMounts, planOneRow } from '@deepseek-ai/dsh-mcp-config-claude/src/config.ts'
import type { PlanMountsOptions } from '@deepseek-ai/dsh-mcp-config-claude/src/config.ts'

const baseOptions: PlanMountsOptions = { toolCallTimeoutMs: 60_000 }

describe('planOneRow — transport inference for an untyped row', () => {
  it('infers "stdio" for a row with a command and no explicit type, matching Claude Code\'s own .mcp.json shape', () => {
    const decision = planOneRow('awake', { command: 'node', args: ['s.mjs'] }, baseOptions)
    if (!('mount' in decision)) throw new Error(`expected a mount, got a skip: ${JSON.stringify(decision)}`)
    expect(decision.mount.config).toMatchObject({ transport: 'stdio', command: 'node', args: ['s.mjs'] })
  })

  it('still skips an untyped row with no command as an unrecognized transport', () => {
    const decision = planOneRow('weird', { args: ['x'] }, baseOptions)
    if (!('skip' in decision)) throw new Error('expected a skip')
    expect(decision.skip.reason).toContain('missing')
  })
})

describe('planMounts — include-list fail-closed semantics', () => {
  it('mounts every row when include is omitted (not configured)', () => {
    const plan = planMounts({ awake: { type: 'stdio', command: 'node' } }, baseOptions)
    expect(plan.mounts.map(m => m.serverName)).toEqual(['awake'])
  })

  it('mounts nothing when include is explicitly an empty array (fails closed, never "no filter")', () => {
    const plan = planMounts(
      { awake: { type: 'stdio', command: 'node' }, saturnai: { type: 'stdio', command: 'node' } },
      { ...baseOptions, include: [] },
    )
    expect(plan.mounts).toEqual([])
    expect(plan.skipped.map(s => s.serverName)).toEqual(['awake', 'saturnai'])
    expect(plan.skipped.every(s => s.reason === 'not in the configured include list')).toBe(true)
  })
})
