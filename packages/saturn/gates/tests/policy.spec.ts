import { describe, expect, it } from 'vitest'
import { classify, compilePolicy } from '../src/policy.ts'
import { DEFAULT_RULES } from '../src/roster.ts'
import type { GateClass } from '../src/types.ts'

/**
 * Classification suite for the shipped Gate policy: the roster-derived
 * defaults (shell command text and the real MCP tool names izzy mounts), the
 * negative cases that must stay transparent, and fail-loud policy validation.
 */

const policy = compilePolicy({})

/** Classify one shell command as the `bash` tool would present it. */
function shell(command: string, tool = 'bash') {
  return classify(policy, { name: tool, arguments: { command, description: 'd' } })
}

/** Classify one MCP call by name alone (Gate-class MCP rules never read arguments). */
function mcp(name: string) {
  return classify(policy, { name, arguments: {} })
}

describe('shell command classification', () => {
  const asks: [string, GateClass][] = [
    ['git push --force origin master', 'publish'],
    ['git push -f origin master', 'publish'],
    ['curl -X POST https://hooks.slack.com/services/x -d @body.json', 'outbound'],
    ['curl -s -X POST https://discord.com/api/webhooks/1/abc', 'outbound'],
    ['rm -rf C:/Users', 'destructive'],
    ['rm -rf ~/projects', 'destructive'],
    ['rm -r -f /var/data', 'destructive'],
    ['git reset --hard origin/master', 'destructive'],
    ['git clean -fdx', 'destructive'],
    ['psql -c "DROP TABLE orders"', 'destructive'],
    ['npm publish --access public', 'publish'],
    ['vercel deploy --prod', 'publish'],
    ['wrangler pages deploy dist', 'publish'],
    ['gh release create v1.0.0', 'publish'],
    ['node scripts/ship.mjs', 'publish'],
    ['gh auth login', 'credentials'],
    ['cat .env.production', 'credentials'],
    ['Get-Content ~/.ssh/id_rsa', 'credentials'],
    ['export STRIPE_SECRET_KEY=x', 'credentials'],
    ['stripe payment_intents create --amount 500', 'spend'],
    ['namecheap dns set saturnai.tools', 'identity'],
  ]

  it.each(asks)('asks for %s', (command, expected) => {
    const match = shell(command)
    expect(match?.action).toBe('ask')
    expect(match?.class).toBe(expected)
    expect(match?.reason.length).toBeGreaterThan(0)
  })

  const denies: string[] = [
    'rm -rf /',
    'rm -rf / --no-preserve-root',
    ':(){:|:&};:',
    'mkfs.ext4 /dev/sda1',
    'dd if=/dev/zero of=/dev/sda bs=1M',
  ]

  it.each(denies)('denies %s outright', (command) => {
    expect(shell(command)?.action).toBe('deny')
  })

  const passes: string[] = [
    'ls',
    'ls -la packages/saturn',
    'git status',
    'git push origin feature-branch',
    'rm -rf node_modules',
    'rm -rf ./dist',
    'npm run build',
    'curl -s https://example.com/readme.txt',
    'node_modules/.bin/vitest run packages/saturn/gates',
  ]

  it.each(passes)('lets %s through', (command) => {
    expect(shell(command)).toBeUndefined()
  })

  it('reads the pwsh command field and the terminal_send text field', () => {
    expect(shell('git push --force origin master', 'pwsh')?.class).toBe('publish')
    expect(classify(policy, { name: 'terminal_send', arguments: { sessionId: 's', text: 'git push --force' } })?.class).toBe('publish')
  })

  it('ignores command text on a tool the rule does not scope', () => {
    expect(classify(policy, { name: 'write', arguments: { path: 'a.md', command: 'git push --force' } })).toBeUndefined()
  })
})

describe('MCP roster classification', () => {
  const asks: [string, GateClass][] = [
    ['mcp__telegram-hive__send_approved', 'outbound'],
    ['mcp__telegram-hive__schedule', 'outbound'],
    ['mcp__shop-ops__create_invoice', 'spend'],
    ['mcp__shop-ops__update_price', 'spend'],
    ['mcp__shop-ops__deploy_store', 'publish'],
    ['mcp__gemini-media__generate_video', 'spend'],
    ['mcp__gemini-media__generate_image', 'spend'],
    ['mcp__saturn-browser__keychain_get', 'credentials'],
    ['mcp__saturn-browser__keychain_export', 'credentials'],
    ['mcp__saturn-browser__keychain_rekey', 'credentials'],
    ['mcp__saturn-browser__login', 'credentials'],
    ['mcp__saturn-browser__cookies', 'credentials'],
    ['mcp__saturndesign__propose', 'publish'],
    ['mcp__vercel__deploy_to_vercel', 'publish'],
    ['mcp__vercel__buy_domain', 'identity'],
    ['mcp__vercel__buy_credits', 'spend'],
    ['mcp__gmail__send_message', 'outbound'],
    ['mcp__media__tiktok_publish', 'outbound'],
  ]

  it.each(asks)('asks for %s', (name, expected) => {
    const match = mcp(name)
    expect(match?.action).toBe('ask')
    expect(match?.class).toBe(expected)
  })

  const passes: string[] = [
    'mcp__awake__recall',
    'mcp__awake__record',
    'mcp__saturndesign__compose',
    'mcp__saturndesign__search',
    'mcp__shop-ops__list_products',
    'mcp__telegram-hive__inbox',
    'mcp__saturn-browser__snapshot',
    'read',
    'glob',
    'grep',
    'edit',
  ]

  it.each(passes)('lets %s through', (name) => {
    expect(mcp(name)).toBeUndefined()
  })
})

describe('policy composition', () => {
  it('honours a user-added rule', () => {
    const custom = compilePolicy({
      rules: [{
        id: 'user-bba-ledger',
        class: 'spend',
        tools: ['bash'],
        pattern: 'bba-intel\\s+charge',
        reason: 'This command charges the BBA ledger.',
      }],
    })
    const match = classify(custom, { name: 'bash', arguments: { command: 'node bba-intel charge 40' } })
    expect(match).toMatchObject({ ruleId: 'user-bba-ledger', class: 'spend', action: 'ask' })
  })

  it('honours a user-added tool-name rule for a server the defaults do not know', () => {
    const custom = compilePolicy({
      rules: [{
        id: 'user-sentry-delete',
        class: 'destructive',
        action: 'deny',
        tools: ['mcp__sentry__delete_*'],
        reason: 'This call deletes a Sentry project.',
      }],
    })
    expect(classify(custom, { name: 'mcp__sentry__delete_project', arguments: {} })?.action).toBe('deny')
  })

  it('drops a default rule named in disableRules', () => {
    const custom = compilePolicy({ disableRules: ['publish-git-force-push'] })
    expect(classify(custom, { name: 'bash', arguments: { command: 'git push --force origin master' } })).toBeUndefined()
  })

  it('exempts a tool named in allow', () => {
    const custom = compilePolicy({ allow: ['mcp__gemini-media__*'] })
    expect(classify(custom, { name: 'mcp__gemini-media__generate_video', arguments: {} })).toBeUndefined()
    expect(classify(custom, { name: 'mcp__saturn-browser__keychain_get', arguments: {} })?.class).toBe('credentials')
  })

  it('drops every default when includeDefaults is false', () => {
    const custom = compilePolicy({ includeDefaults: false })
    expect(classify(custom, { name: 'bash', arguments: { command: 'rm -rf /' } })).toBeUndefined()
  })

  it('prefers deny over ask when both match', () => {
    const custom = compilePolicy({
      rules: [{
        id: 'user-no-force-push',
        class: 'publish',
        action: 'deny',
        tools: ['bash'],
        pattern: 'git\\s+push[^\\n]*--force',
        reason: 'Force-pushing is disabled on this machine.',
      }],
    })
    expect(classify(custom, { name: 'bash', arguments: { command: 'git push --force origin master' } })?.action).toBe('deny')
  })

  it('classifies without arguments, a null argument value, or a non-string command', () => {
    expect(classify(policy, { name: 'bash', arguments: undefined })).toBeUndefined()
    expect(classify(policy, { name: 'bash', arguments: null })).toBeUndefined()
    expect(classify(policy, { name: 'bash', arguments: { command: 42 } })).toBeUndefined()
    expect(classify(policy, { name: 'mcp__saturn-browser__keychain_get', arguments: null })?.class).toBe('credentials')
  })
})

describe('fail-loud validation', () => {
  it('rejects a duplicate rule id', () => {
    expect(() => compilePolicy({
      rules: [{ id: 'publish-git-force-push', class: 'publish', tools: ['bash'], reason: 'r' }],
    })).toThrow(/duplicate rule id/)
  })

  it('rejects an uncompilable pattern', () => {
    expect(() => compilePolicy({
      rules: [{ id: 'bad-pattern', class: 'spend', tools: ['bash'], pattern: '([a-z', reason: 'r' }],
    })).toThrow(/invalid pattern/)
  })

  it('rejects an empty tools list', () => {
    expect(() => compilePolicy({
      rules: [{ id: 'no-tools', class: 'spend', tools: [], reason: 'r' }],
    })).toThrow(/at least one tool pattern/)
  })

  it('rejects an empty reason', () => {
    expect(() => compilePolicy({
      rules: [{ id: 'no-reason', class: 'spend', tools: ['bash'], reason: '   ' }],
    })).toThrow(/reason/)
  })

  it('rejects an unknown gate class', () => {
    expect(() => compilePolicy({
      rules: [{ id: 'bad-class', class: 'vibes' as GateClass, tools: ['bash'], reason: 'r' }],
    })).toThrow(/unknown gate class/)
  })

  it('rejects disableRules naming a rule that does not exist', () => {
    expect(() => compilePolicy({ disableRules: ['not-a-rule'] })).toThrow(/not-a-rule/)
  })

  it('rejects an empty commandFields list', () => {
    expect(() => compilePolicy({ commandFields: [] })).toThrow(/commandFields/)
  })
})

describe('the shipped roster', () => {
  it('gives every default rule a unique id, a reason, and at least one tool pattern', () => {
    const ids = DEFAULT_RULES.map(rule => rule.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const rule of DEFAULT_RULES) {
      expect(rule.reason.trim().length).toBeGreaterThan(0)
      expect(rule.tools.length).toBeGreaterThan(0)
    }
  })

  it('covers every Gate class', () => {
    const classes = new Set(DEFAULT_RULES.map(rule => rule.class))
    expect([...classes].sort()).toEqual(['credentials', 'destructive', 'identity', 'outbound', 'publish', 'spend'])
  })
})
