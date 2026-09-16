// @vitest-environment jsdom
/**
 * Settings → Models, Hugging Face card: the localized tools badge (SPEC-HF
 * §4.4). The discovery wire carries only id and capacity, so tool support is
 * read from the Host model catalog's live description line — the same line
 * the composer picker renders its badge from.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { HuggingFaceCard } from '../src/client/HuggingFaceCard.tsx'
import { createModelsOperations } from '../src/client/operations.ts'
import type { ModelsOperations } from '../src/client/operations.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const dictionary = en as Record<string, string>
const t = ((key: string) => dictionary[key] ?? key) as (key: keyof typeof en) => string

function namespace(): SettingsNamespaceView {
  return {
    ns: 'llm-pi-ai',
    schema: {},
    value: { providers: { huggingface: { apiKeyEnv: 'HF_TOKEN', models: [] } } },
    base: { providers: { huggingface: { apiKeyEnv: 'HF_TOKEN', models: [] } } },
    user: { providers: {} },
    applies: 'live',
    secrets: [],
    revision: 1,
  }
}

function operations(overrides: Partial<ModelsOperations> = {}): ModelsOperations {
  return {
    describeCredential: vi.fn(() => Promise.resolve(undefined)),
    storeCredential: vi.fn(() => Promise.resolve(undefined)),
    removeCredential: vi.fn(() => Promise.resolve(undefined)),
    writeSettings: vi.fn(() => Promise.resolve({ kind: 'written' as const, view: namespace() })),
    discoverModels: vi.fn(() => Promise.resolve({
      kind: 'found' as const,
      models: [
        { id: 'openai/gpt-oss-120b', contextWindow: 131072 },
        { id: 'Qwen/Qwen2.5-VL-7B-Instruct', contextWindow: 32768 },
      ],
    })),
    liveModelTools: vi.fn(() => Promise.resolve(new Set(['openai/gpt-oss-120b']))),
    ...overrides,
  }
}

describe('HuggingFaceCard tools badge', () => {
  it('ships the badge copy in en and zh', () => {
    expect(typeof (en as Record<string, string>)['hf.tools']).toBe('string')
    expect(typeof (zh as Record<string, string>)['hf.tools']).toBe('string')
    expect((en as Record<string, string>)['hf.tools']).not.toBe((zh as Record<string, string>)['hf.tools'])
  })

  it('badges only the models a live provider serves with tools', async () => {
    const ops = operations()
    render(<HuggingFaceCard operations={ops} namespace={namespace()} keyConfigured readOnly={false} t={t} onChanged={vi.fn()} />)
    const group = await screen.findByRole('group', { name: dictionary['hf.group']! })
    const withTools = await within(group).findByText('openai/gpt-oss-120b')
    await waitFor(() => { expect(within(withTools.closest('li')!).getByText(dictionary['hf.tools']!)).toBeTruthy() })
    const withoutTools = within(group).getByText('Qwen/Qwen2.5-VL-7B-Instruct').closest('li')!
    expect(within(withoutTools).queryByText(dictionary['hf.tools']!)).toBeNull()
    expect(ops.liveModelTools).toHaveBeenCalledWith('huggingface')
  })

  it('renders the list without badges when tool facts are unavailable', async () => {
    const ops = operations({ liveModelTools: vi.fn(() => Promise.reject(new Error('catalog offline'))) })
    render(<HuggingFaceCard operations={ops} namespace={namespace()} keyConfigured readOnly={false} t={t} onChanged={vi.fn()} />)
    const group = await screen.findByRole('group', { name: dictionary['hf.group']! })
    await within(group).findByText('openai/gpt-oss-120b')
    await waitFor(() => { expect(ops.liveModelTools).toHaveBeenCalled() })
    expect(within(group).queryByText(dictionary['hf.tools']!)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('createModelsOperations().liveModelTools', () => {
  it('reads tool support from the route group of the Host model catalog, suffixes ignored', async () => {
    const modelCatalog = vi.fn(() => Promise.resolve({
      ok: true,
      value: {
        default: { provider: 'huggingface', model: 'openai/gpt-oss-120b' },
        routableProviders: ['huggingface', 'other'],
        groups: [
          {
            id: 'huggingface',
            name: 'Hugging Face',
            models: [
              { id: 'openai/gpt-oss-120b:cheapest', name: 'GPT-OSS 120B', description: '131K context · tools · via groq, cerebras' },
              { id: 'Qwen/Qwen2.5-VL-7B-Instruct', name: 'Qwen/Qwen2.5-VL-7B-Instruct', description: '32K context · via hyperbolic' },
              { id: 'meta-llama/Llama-3.1-8B-Instruct', name: 'Llama', description: 'Handwritten note mentioning tools' },
            ],
          },
          { id: 'other', name: 'Other', models: [{ id: 'x/tools-model', name: 'x', description: 'tools' }] },
        ],
        failures: [],
      },
    }))
    const ctx = { remote: { session: { modelCatalog } } } as unknown as ClientContext
    const tools = await createModelsOperations(ctx).liveModelTools!('huggingface')
    expect([...tools]).toEqual(['openai/gpt-oss-120b'])
    expect(modelCatalog).toHaveBeenCalledTimes(1)
  })

  it('answers an empty set when the catalog read is refused', async () => {
    const modelCatalog = vi.fn(() => Promise.resolve({ ok: false, error: { code: 'x', message: 'refused' } }))
    const ctx = { remote: { session: { modelCatalog } } } as unknown as ClientContext
    const tools = await createModelsOperations(ctx).liveModelTools!('huggingface')
    expect(tools.size).toBe(0)
  })
})
