/** First-run wizard projections: known provider credential presence and the static connect-form catalog. */
import { describe, expect, it } from 'vitest'
import { parseBotConfig } from '../src/config.ts'
import { botIntegrationCatalog, describeFirstRun } from '../src/wizard.ts'

describe('describeFirstRun', () => {
  it('reports the current goal, workspace, provider, and whether its known credential is present', () => {
    const config = parseBotConfig({ goal: 'Grow the shop', workspace: '/tmp/shop', provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    expect(describeFirstRun(config, {})).toEqual({
      goal: 'Grow the shop', workspace: '/tmp/shop', provider: 'deepseek-official',
      credentials: [{ name: 'DeepSeek', env: 'DEEPSEEK_API_KEY', present: false }],
    })
    expect(describeFirstRun(config, { DEEPSEEK_API_KEY: 'sk-example' }).credentials).toEqual([{ name: 'DeepSeek', env: 'DEEPSEEK_API_KEY', present: true }])
  })

  it('reports no known credential rows for an unrecognized provider rather than fabricating one', () => {
    const config = parseBotConfig({ provider: 'a-provider-not-in-the-curated-list' })
    expect(describeFirstRun(config, {}).credentials).toEqual([])
  })
})

describe('botIntegrationCatalog', () => {
  it('describes every integration this runtime supports with field-level, non-secret-echoing forms', () => {
    const catalog = botIntegrationCatalog()
    const names = catalog.map(entry => entry.name)
    expect(names).toEqual(expect.arrayContaining(['github', 'email', 'stripe', 'cloud', 'social', 'creative', 'webhook', 'telegram', 'shopify', 'vercel', 'cloudflare-pages']))
    for (const entry of catalog) {
      expect(entry.label.length).toBeGreaterThan(0)
      expect(entry.docsUrl.length).toBeGreaterThan(0)
      expect(entry.fields.length).toBeGreaterThan(0)
      for (const field of entry.fields) {
        expect(field.key.length).toBeGreaterThan(0)
        expect(field.label.length).toBeGreaterThan(0)
        if (!field.secret) expect(field.env).toBeUndefined()
      }
    }
    const github = catalog.find(entry => entry.name === 'github')!
    expect(github.fields.find(field => field.secret)?.env).toBe('SATURN_GITHUB_TOKEN')
  })
})
