import { describe, expect, it } from 'vitest'
import { carriesSandboxEscalation, classify, compilePolicy } from '../src/policy.ts'
import type { GateClass } from '../src/types.ts'

/**
 * The second review pass over the pure policy. Three properties a reviewer
 * found missing from the first roster, each pinned here so it cannot regress:
 * a recursive delete that escapes the workspace by RELATIVE traversal is still
 * a destructive act; a tool-name exemption buys an `ask` and never a `deny`;
 * and a claimed escalation only excuses a call when the mode it names is one
 * the sandbox family will actually put to a human.
 */
const policy = compilePolicy({})

/** Classify one shell command as `bash` would carry it. */
function shell(command: string) {
  return classify(policy, { name: 'bash', arguments: { command } })
}

describe('a recursive delete that escapes the workspace by relative traversal', () => {
  const asks: [string, GateClass][] = [
    ['rm -rf ../../../important', 'destructive'],
    ['rm -rf ../sibling-project', 'destructive'],
    ['rm -rf ..\\..\\build', 'destructive'],
    ['rm -rf ..', 'destructive'],
    ['rm -fr ../..', 'destructive'],
  ]

  it.each(asks)('asks for %s', (command, expected) => {
    const match = shell(command)
    expect(match?.action).toBe('ask')
    expect(match?.class).toBe(expected)
    expect(match?.ruleId).toBe('destructive-recursive-delete')
  })

  const passes: string[] = [
    'rm -rf ./dist',
    'rm -rf node_modules',
    'rm -rf packages/saturn/gates/lib',
  ]

  it.each(passes)('still lets %s through', (command) => {
    expect(shell(command)).toBeUndefined()
  })

  it('reads a bare trailing .. even when another line follows it', () => {
    expect(classify(policy, { name: 'bash', arguments: { command: 'rm -rf ..\ngit status' } })?.class).toBe('destructive')
  })
})

describe('a tool-name exemption cannot disarm a deny rule', () => {
  it('keeps the four deny rules armed for a tool named in allow', () => {
    const custom = compilePolicy({ allow: ['bash'] })
    expect(classify(custom, { name: 'bash', arguments: { command: 'mkfs.ext4 /dev/sda1' } })?.action).toBe('deny')
    expect(classify(custom, { name: 'bash', arguments: { command: 'rm -rf / --no-preserve-root' } })?.action).toBe('deny')
    expect(classify(custom, { name: 'bash', arguments: { command: ':(){:|:&};:' } })?.action).toBe('deny')
    expect(classify(custom, { name: 'bash', arguments: { command: 'dd if=/dev/zero of=/dev/sda bs=1M' } })?.action).toBe('deny')
  })

  it('still exempts the ask rules for that same tool', () => {
    const custom = compilePolicy({ allow: ['bash'] })
    expect(classify(custom, { name: 'bash', arguments: { command: 'git push --force origin master' } })).toBeUndefined()
    expect(classify(custom, { name: 'bash', arguments: { command: 'rm -rf ~/projects' } })).toBeUndefined()
  })

  it('exempts a wildcard-named MCP tool from its ask rule', () => {
    const custom = compilePolicy({ allow: ['mcp__gemini-media__*'] })
    expect(classify(custom, { name: 'mcp__gemini-media__generate_video', arguments: {} })).toBeUndefined()
    expect(classify(custom, { name: 'mcp__shop-ops__create_invoice', arguments: {} })?.class).toBe('spend')
  })

  it('cannot disarm a user-added deny rule either', () => {
    const custom = compilePolicy({
      allow: ['bash'],
      rules: [{ id: 'user-no-force-push', class: 'publish', action: 'deny', tools: ['bash'], pattern: String.raw`git\s+push\s+--force`, reason: 'No force pushes from a session.' }],
    })
    expect(classify(custom, { name: 'bash', arguments: { command: 'git push --force origin master' } })?.action).toBe('deny')
  })
})

describe('only a real escalation mode excuses a claimed call', () => {
  const escalating = (mode: unknown) => carriesSandboxEscalation(policy, {
    name: 'bash',
    arguments: { command: 'git push --force origin master', sandbox_permissions: mode, justification: 'the remote lives outside the workspace' },
  })

  it('accepts the two modes the sandbox family can be escalated to', () => {
    expect(escalating('workspace-write')).toBe(true)
    expect(escalating('danger-full-access')).toBe(true)
  })

  it('rejects a mode outside that vocabulary, so junk cannot suppress the Gate', () => {
    expect(escalating('bogus-not-a-mode')).toBe(false)
    expect(escalating('read-only')).toBe(false)
    expect(escalating('')).toBe(false)
    expect(escalating(7)).toBe(false)
  })

  it('still requires the justification the escalating tools require', () => {
    expect(carriesSandboxEscalation(policy, {
      name: 'bash',
      arguments: { command: 'git push --force origin master', sandbox_permissions: 'danger-full-access' },
    })).toBe(false)
  })

  it('takes the vocabulary from config when a deployment names its own', () => {
    const custom = compilePolicy({ escalationModes: ['elevated'] })
    expect(carriesSandboxEscalation(custom, {
      name: 'bash',
      arguments: { command: 'git push --force origin master', sandbox_permissions: 'elevated', justification: 'why' },
    })).toBe(true)
    expect(carriesSandboxEscalation(custom, {
      name: 'bash',
      arguments: { command: 'git push --force origin master', sandbox_permissions: 'danger-full-access', justification: 'why' },
    })).toBe(false)
  })
})
