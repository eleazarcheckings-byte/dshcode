/**
 * The mode picker is a user-facing surface, so it must read in plain product
 * language: plain names (Agent / Code / Lite / Creator), never the internal
 * sphere names, PTC, Cordis, or tool ids the modes are built from.
 */

import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

/** Terms a user must never meet in shipped copy. */
const FORBIDDEN = /Tiphareth|Kether|Malkuth|Hod|PTC SDK|str_replace_editor|Cordis/i

describe('mode picker plain-language gate', () => {
  it('shows only the four plain mode names', () => {
    expect([en.presetStandardName, en.presetPtcName, en.presetMinimalName, en.presetCordisName])
      .toEqual(['Agent', 'Code', 'Lite', 'Creator'])
    expect([zh.presetStandardName, zh.presetPtcName, zh.presetMinimalName, zh.presetCordisName])
      .toEqual(['Agent', 'Code', 'Lite', 'Creator'])
  })

  it('keeps both dictionaries free of internal jargon', () => {
    for (const [locale, bundle] of [['en', en], ['zh', zh]] as const) {
      for (const [key, value] of Object.entries(bundle)) {
        expect(value, `${locale}.${key}`).not.toMatch(FORBIDDEN)
      }
    }
  })
})
