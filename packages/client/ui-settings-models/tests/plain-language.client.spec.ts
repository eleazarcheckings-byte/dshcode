/**
 * Plain-language gate. Every surface a user reads must stay in product
 * language: no Kabbalah sphere names, no PTC, no Cordis, no internal tool ids,
 * no "plugin ecosystem", no "harness developers". This scans the dictionaries
 * directly, so a jargon string cannot slip in through a key nobody re-read.
 */

import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

/** Terms a user must never meet in shipped copy. */
const FORBIDDEN = /Tiphareth|Kether|Malkuth|Hod|PTC SDK|str_replace_editor|Cordis/i

/** Every string value of one dictionary, tagged with its key for the failure message. */
function entries(bundle: Record<string, string>): [string, string][] {
  return Object.entries(bundle).filter((pair): pair is [string, string] => typeof pair[1] === 'string')
}

describe('plain-language copy gate', () => {
  it('keeps the Models and First Light dictionaries free of internal jargon', () => {
    for (const [locale, bundle] of [['en', en], ['zh', zh]] as const) {
      for (const [key, value] of entries(bundle)) {
        expect(value, `${locale}.${key}`).not.toMatch(FORBIDDEN)
      }
    }
  })

  it('never names the transport "MCP" on the Design brain or Connections steps', () => {
    expect([en.firstLightBrainTitle, en.firstLightBrainBody, en.firstLightReceiptBrain, en.firstLightConnectorsTitle])
      .not.toContain('MCP')
    for (const [key, value] of entries(zh)) {
      expect(value, `zh.${key}`).not.toMatch(/MCP/i)
    }
  })

  it('leads First Light with a model engine, not DeepSeek as the product', () => {
    expect(en.onboardingDescription).not.toMatch(/^Connect DeepSeek/i)
    expect(en.onboardingDescription).toMatch(/model engine/i)
    expect(en.onboardingDescription).toMatch(/DeepSeek/)
    expect(en.firstLightModelUnavailable).not.toMatch(/DeepSeek setup/i)
    expect(zh.onboardingDescription).not.toMatch(/^在此连接 DeepSeek/)
    expect(zh.onboardingDescription).toMatch(/模型引擎/)
  })
})
