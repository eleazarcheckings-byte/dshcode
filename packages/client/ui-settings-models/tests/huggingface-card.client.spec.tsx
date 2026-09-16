// @vitest-environment jsdom
/** Settings → Models: the Hugging Face card — token onboarding, the searchable model group, routing choice, and typed ids. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { HuggingFaceCard } from '../src/client/HuggingFaceCard.tsx'
import {
  HF_BILLING_URL, HF_ROUTE, HF_TOKEN_REF, HF_TOKEN_URL, huggingFaceErrorKey, isRoutableModelId, withRoutingSuffix,
} from '../src/client/huggingface.ts'
import type { ModelsOperations } from '../src/client/operations.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const dictionary = en as Record<string, string>
const t = ((key: string) => dictionary[key] ?? key) as (key: keyof typeof en) => string
const copy = (key: string): string => dictionary[key] ?? key

const TOKEN = 'hf_fixtureTokenNeverReal0000'

function namespace(models: { id: string }[] = []): SettingsNamespaceView {
  return {
    ns: 'llm-pi-ai',
    schema: {},
    value: { providers: { huggingface: { apiKeyEnv: 'HF_TOKEN', models } } },
    base: { providers: { huggingface: { apiKeyEnv: 'HF_TOKEN', models } } },
    user: { providers: {} },
    applies: 'live',
    secrets: [],
    revision: 4,
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
        { id: 'meta-llama/Llama-3.1-8B-Instruct' },
      ],
    })),
    ...overrides,
  }
}

describe('huggingface helpers (settings)', () => {
  it('pins the route, the credential reference, and the two links', () => {
    expect(HF_ROUTE).toBe('huggingface')
    expect(HF_TOKEN_REF).toBe('HF_TOKEN')
    expect(HF_TOKEN_URL).toBe('https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained')
    expect(HF_BILLING_URL).toBe('https://huggingface.co/settings/billing')
    expect(withRoutingSuffix('org/name', 'cheapest')).toBe('org/name:cheapest')
    expect(withRoutingSuffix('org/name:groq', 'cheapest')).toBe('org/name:groq')
    expect(isRoutableModelId('org/name/extra')).toBe(false)
  })

  it('maps every router failure tag to a key present in en and zh', () => {
    for (const kind of ['unauthorized', 'credits', 'gated', 'notFound', 'rateLimited']) {
      const key = huggingFaceErrorKey(`[huggingface:${kind}] detail`)
      expect(key).toBe(`hf.error.${kind}`)
      expect(key! in en).toBe(true)
      expect(key! in zh).toBe(true)
    }
    expect(huggingFaceErrorKey('https://x/v1/models answered 500')).toBeUndefined()
  })
})

describe('HuggingFaceCard', () => {
  it('explains the token and links the fine-grained token page while no token is stored', async () => {
    const ops = operations()
    const onChanged = vi.fn()
    const log = vi.spyOn(console, 'log')
    const info = vi.spyOn(console, 'info')
    render(<HuggingFaceCard operations={ops} namespace={namespace()} keyConfigured={false} readOnly={false} t={t} onChanged={onChanged} />)
    expect(screen.getByText(copy('hf.tokenIntro'))).toBeTruthy()
    const link = screen.getByRole('link', { name: copy('hf.tokenLink') })
    expect(link.getAttribute('href')).toBe(HF_TOKEN_URL)
    expect(ops.discoverModels).not.toHaveBeenCalled()

    const field = screen.getByLabelText(copy('hf.tokenLabel'))
    expect(field.getAttribute('type')).toBe('password')
    fireEvent.change(field, { target: { value: `  ${TOKEN}  ` } })
    fireEvent.click(screen.getByRole('button', { name: copy('hf.tokenSave') }))
    await waitFor(() => { expect(ops.storeCredential).toHaveBeenCalledWith('HF_TOKEN', TOKEN) })
    await waitFor(() => { expect(onChanged).toHaveBeenCalled() })
    expect(JSON.stringify([...log.mock.calls, ...info.mock.calls])).not.toContain(TOKEN)
    log.mockRestore()
    info.mockRestore()
  })

  it('renders a searchable Hugging Face group from the live listing', async () => {
    const ops = operations()
    render(<HuggingFaceCard operations={ops} namespace={namespace()} keyConfigured readOnly={false} t={t} onChanged={vi.fn()} />)
    const group = await screen.findByRole('group', { name: copy('hf.group') })
    await waitFor(() => { expect(within(group).getAllByRole('listitem')).toHaveLength(3) })
    expect(ops.discoverModels).toHaveBeenCalledWith('llm-pi-ai', expect.objectContaining({ provider: 'huggingface' }))
    expect(within(group).getByText('openai/gpt-oss-120b').closest('li')?.textContent).toContain('131K')

    fireEvent.change(screen.getByRole('searchbox', { name: copy('hf.search') }), { target: { value: 'LLAMA' } })
    await waitFor(() => { expect(within(group).getAllByRole('listitem')).toHaveLength(1) })
    expect(within(group).getByText('meta-llama/Llama-3.1-8B-Instruct')).toBeTruthy()
  })

  it('pins a listed model with the chosen routing policy', async () => {
    const pinned = [{ id: 'deepseek-ai/DeepSeek-V3.1' }]
    const ops = operations()
    const onChanged = vi.fn()
    render(<HuggingFaceCard operations={ops} namespace={namespace(pinned)} keyConfigured readOnly={false} t={t} onChanged={onChanged} />)
    await screen.findByText('openai/gpt-oss-120b')
    fireEvent.change(screen.getByRole('combobox', { name: copy('hf.policy') }), { target: { value: 'cheapest' } })
    fireEvent.click(screen.getByRole('button', { name: `${copy('hf.add')} openai/gpt-oss-120b` }))
    await waitFor(() => {
      expect(ops.writeSettings).toHaveBeenCalledWith('llm-pi-ai', [{
        op: 'set',
        path: ['providers', 'huggingface', 'models'],
        value: [{ id: 'deepseek-ai/DeepSeek-V3.1' }, { id: 'openai/gpt-oss-120b:cheapest' }],
      }], 4)
    })
    await waitFor(() => { expect(onChanged).toHaveBeenCalled() })
  })

  it('validates a typed model id before saving it', async () => {
    const ops = operations()
    render(<HuggingFaceCard operations={ops} namespace={namespace()} keyConfigured readOnly={false} t={t} onChanged={vi.fn()} />)
    const input = screen.getByRole('textbox', { name: copy('hf.idLabel') })
    fireEvent.change(input, { target: { value: 'gpt-4o' } })
    fireEvent.click(screen.getByRole('button', { name: copy('hf.idUse') }))
    expect(await screen.findByText(copy('hf.idInvalid'))).toBeTruthy()
    expect(ops.writeSettings).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'someorg/new-model:groq' } })
    fireEvent.click(screen.getByRole('button', { name: copy('hf.idUse') }))
    await waitFor(() => {
      expect(ops.writeSettings).toHaveBeenCalledWith('llm-pi-ai', [{
        op: 'set',
        path: ['providers', 'huggingface', 'models'],
        value: [{ id: 'someorg/new-model:groq' }],
      }], 4)
    })
  })

  it('shows the localized router failure when the listing is refused', async () => {
    const ops = operations({
      discoverModels: vi.fn(() => Promise.resolve({
        kind: 'refused' as const,
        message: '[huggingface:credits] Hugging Face credits are exhausted',
      })),
    })
    render(<HuggingFaceCard operations={ops} namespace={namespace()} keyConfigured readOnly={false} t={t} onChanged={vi.fn()} />)
    expect(await screen.findByText(copy('hf.error.credits'))).toBeTruthy()
    expect(screen.getByRole('link', { name: copy('hf.billingLink') }).getAttribute('href')).toBe(HF_BILLING_URL)
  })
})
