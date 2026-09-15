/** Local `.env` credential fallback: parsed once, process env always wins, never logs values. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseDotEnv, readBotEnvFile, resolveBotEnvironment } from '../src/adapters/env-file.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function directory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'saturnbot-env-'))
  cleanups.push(async () => { await rm(root, { recursive: true, force: true }) })
  return root
}

describe('parseDotEnv', () => {
  it('parses KEY=VALUE lines, ignoring comments, blank lines, export prefixes, and quotes', () => {
    const text = [
      '# a comment', '', 'export SATURN_GITHUB_TOKEN=ghp_example', 'SATURN_STRIPE_KEY="sk_test_example"',
      "SATURN_TELEGRAM_BOT_TOKEN='bot:example'", 'MALFORMED LINE WITHOUT EQUALS', 'SPACED = value with spaces ',
    ].join('\n')
    expect(parseDotEnv(text)).toEqual({
      SATURN_GITHUB_TOKEN: 'ghp_example', SATURN_STRIPE_KEY: 'sk_test_example',
      SATURN_TELEGRAM_BOT_TOKEN: 'bot:example', SPACED: 'value with spaces',
    })
  })
})

describe('readBotEnvFile', () => {
  it('returns an empty map when the data directory or file is absent', async () => {
    const root = await directory()
    expect(readBotEnvFile(join(root, 'missing'))).toEqual({})
  })

  it('reads the data directory .env file', async () => {
    const root = await directory()
    await writeFile(join(root, '.env'), 'SATURN_SHOPIFY_TOKEN=shpat_example\n')
    expect(readBotEnvFile(root)).toEqual({ SATURN_SHOPIFY_TOKEN: 'shpat_example' })
  })

  it('rejects an oversized file rather than silently truncating a secret', async () => {
    const root = await directory()
    await writeFile(join(root, '.env'), `BIG=${'x'.repeat(200_000)}`)
    expect(() => readBotEnvFile(root)).toThrow(/permitted size/)
  })
})

describe('resolveBotEnvironment', () => {
  it('lets an explicit process value win over the file fallback, and never echoes the value in errors', async () => {
    const root = await directory()
    await mkdir(root, { recursive: true })
    await writeFile(join(root, '.env'), 'SATURN_GITHUB_TOKEN=from-file\nSATURN_STRIPE_KEY=only-in-file\n')
    const merged = resolveBotEnvironment(root, { SATURN_GITHUB_TOKEN: 'from-process' })
    expect(merged['SATURN_GITHUB_TOKEN']).toBe('from-process')
    expect(merged['SATURN_STRIPE_KEY']).toBe('only-in-file')
  })

  it('never throws when the directory does not exist yet', async () => {
    const root = await directory()
    expect(() => resolveBotEnvironment(join(root, 'not-created-yet'), {})).not.toThrow()
  })
})
