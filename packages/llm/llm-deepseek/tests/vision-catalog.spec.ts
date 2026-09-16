/**
 * The advertised DeepSeek catalog and the reasoning-effort wire enum, pinned
 * to what the live API answered on 2026-09-15: ids `deepseek-flash` and
 * `deepseek-v4-pro`, both accepting image parts, legacy ids kept only as
 * aliases, and `reasoning_effort` drawn from `none|minimal|low|medium|high|
 * xhigh|max` — never the literal `off`, which the API rejects.
 */

import { describe, expect, it } from 'vitest'
import { LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { DEEPSEEK_WIRE_REASONING_EFFORTS, DEFAULT_MODELS } from '../src/index.ts'
import { serializeRequest } from '../src/serialize.ts'

function byId(id: string) {
  return DEFAULT_MODELS.find(model => model.id === id)
}

function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return { provider: 'deepseek-official', model: 'deepseek-flash', messages: [], ...overrides }
}

describe('DEFAULT_MODELS', () => {
  it('lists deepseek-flash first, with text+image input and the 1M/384K envelope', () => {
    expect(DEFAULT_MODELS[0]?.id).toBe('deepseek-flash')
    expect(DEFAULT_MODELS[0]?.inputModalities).toEqual(['text', 'image'])
    expect(DEFAULT_MODELS[0]?.contextWindow).toBe(1_000_000)
    expect(DEFAULT_MODELS[0]?.maxTokens).toBe(384_000)
  })

  it('declares deepseek-v4-pro as image-capable too', () => {
    expect(byId('deepseek-v4-pro')?.inputModalities).toEqual(['text', 'image'])
  })

  it('keeps the two retired ids as aliases that say so', () => {
    for (const id of ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']) {
      const alias = byId(id)
      expect(alias, id).toBeDefined()
      expect(alias?.description ?? '').toMatch(/alias/i)
      expect(alias?.description ?? '').toContain('deepseek-flash')
      // A legacy id the provider serves with Flash still accepts images.
      expect(alias?.inputModalities, id).toEqual(['text', 'image'])
    }
  })

  it('advertises no id the provider retired without saying it is an alias', () => {
    const live = DEFAULT_MODELS.filter(model => !/alias/i.test(model.description ?? ''))
    expect(live.map(model => model.id)).toEqual(['deepseek-flash', 'deepseek-v4-pro'])
  })
})

describe('reasoning effort on the wire', () => {
  it('serializes "off" as thinking disabled and never as an effort literal', () => {
    const wire = serializeRequest(request({ reasoningEffort: ReasoningEffortId('off') }))
    expect(wire.thinking).toEqual({ type: 'disabled' })
    expect(wire.reasoning_effort).toBeUndefined()
    expect(JSON.stringify(wire)).not.toContain('"reasoning_effort"')
  })

  it('serializes every live level to its own wire literal', () => {
    expect([...DEEPSEEK_WIRE_REASONING_EFFORTS])
      .toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    for (const level of DEEPSEEK_WIRE_REASONING_EFFORTS) {
      const wire = serializeRequest(request({ reasoningEffort: ReasoningEffortId(level) }))
      expect(wire.reasoning_effort, level).toBe(level)
      expect(wire.thinking, level).toEqual({ type: 'enabled' })
    }
  })

  it('refuses an effort the API does not accept', () => {
    expect(() => serializeRequest(request({ reasoningEffort: ReasoningEffortId('turbo') })))
      .toThrow(LlmError)
  })
})
