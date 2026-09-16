// @vitest-environment jsdom
/** The composer picker's Hugging Face group: search, badges, routing choice, typed ids, and error copy. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ComponentProps } from 'react'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import {
  huggingFaceErrorKey, isRoutableModelId, parseLiveDescription, withRoutingSuffix,
} from '../src/client/huggingface.ts'
import { en, zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'

const dictionary = zh as Record<string, string>
const t: ComponentProps<typeof ModelSelect>['t'] = (key, params) => {
  const template = dictionary[key] ?? (commonZh as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}
const copy = (key: string): string => dictionary[key] ?? key

afterEach(cleanup)

const hfGroup = {
  id: 'huggingface',
  name: 'Hugging Face',
  models: [
    { id: 'openai/gpt-oss-120b', name: 'openai/gpt-oss-120b', description: '131K context · tools · via groq, cerebras' },
    { id: 'Qwen/Qwen2.5-VL-7B-Instruct', name: 'Qwen/Qwen2.5-VL-7B-Instruct', description: '33K context · via hyperbolic' },
    { id: 'meta-llama/Llama-3.1-8B-Instruct', name: 'meta-llama/Llama-3.1-8B-Instruct', description: 'tools · via nebius' },
  ],
}
const otherGroup = {
  id: 'deepseek-official',
  name: 'DeepSeek',
  models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' }],
}

function state(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    routable: true,
    groups: [otherGroup, hfGroup],
    failures: [],
    status: 'ready',
    error: null,
    ...overrides,
  }
}

function mount(initial: ModelDirectoryState, select = vi.fn(async (_selection: ModelSelection) => true)) {
  const directory = createSnapshotStore<ModelDirectoryState>(initial)
  render(<ModelSelect locked={false} available directory={directory} load={vi.fn()} select={select} t={t} />)
  return { directory, select }
}

function openModelPane(): void {
  fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(copy('menu.model')) }))
}

describe('huggingface helpers (client)', () => {
  it('builds and validates routed ids', () => {
    expect(withRoutingSuffix('org/name', 'cheapest')).toBe('org/name:cheapest')
    expect(withRoutingSuffix('org/name', 'fastest')).toBe('org/name')
    expect(withRoutingSuffix('org/name:groq', 'cheapest')).toBe('org/name:groq')
    expect(isRoutableModelId('org/name:groq')).toBe(true)
    for (const bad of ['gpt-4o', 'org/', '/name', 'org/name:', 'a b/c', 'org/name/extra']) {
      expect(isRoutableModelId(bad), bad).toBe(false)
    }
  })

  it('reads the adapter description line', () => {
    expect(parseLiveDescription('131K context · tools · via groq, cerebras'))
      .toEqual({ context: '131K', tools: true, providers: ['groq', 'cerebras'] })
    expect(parseLiveDescription('tools · via nebius')).toEqual({ tools: true, providers: ['nebius'] })
    expect(parseLiveDescription('Fast catalog description')).toBeUndefined()
    expect(parseLiveDescription(undefined)).toBeUndefined()
  })

  it('maps router failure tags to localized keys that exist in both dictionaries', () => {
    const cases = {
      '[huggingface:unauthorized] token invalid': 'hf.error.unauthorized',
      '[huggingface:credits] credits exhausted': 'hf.error.credits',
      '[huggingface:gated] accept the license': 'hf.error.gated',
      '[huggingface:notFound] no live provider': 'hf.error.notFound',
      '[huggingface:rateLimited] slow down': 'hf.error.rateLimited',
    }
    for (const [message, key] of Object.entries(cases)) {
      expect(huggingFaceErrorKey(message)).toBe(key)
      expect(key in zh).toBe(true)
      expect(key in en).toBe(true)
    }
    expect(huggingFaceErrorKey('session/model-unavailable')).toBeUndefined()
  })
})

describe('ModelSelect with a Hugging Face group', () => {
  it('shows the Hugging Face group with context and tools badges, and search filters it', () => {
    mount(state())
    openModelPane()
    const group = screen.getByRole('group', { name: 'Hugging Face' })
    expect(within(group).getAllByRole('menuitemradio')).toHaveLength(3)
    const gpt = within(group).getByRole('menuitemradio', { name: /gpt-oss-120b/ })
    expect(gpt.textContent).toContain('131K')
    expect(gpt.textContent).toContain(copy('badge.tools'))
    const qwen = within(group).getByRole('menuitemradio', { name: /Qwen2\.5-VL/ })
    expect(qwen.textContent).not.toContain(copy('badge.tools'))

    fireEvent.change(screen.getByRole('searchbox', { name: copy('hf.search') }), { target: { value: 'qwen' } })
    const filtered = screen.getByRole('group', { name: 'Hugging Face' })
    expect(within(filtered).getAllByRole('menuitemradio').map(item => item.getAttribute('title')))
      .toEqual(['Qwen/Qwen2.5-VL-7B-Instruct'])
  })

  it('selects a Hugging Face model and then offers its routing choices, live providers included', async () => {
    const { directory, select } = mount(state())
    select.mockImplementation(async (selection: ModelSelection) => {
      directory.set(state({ current: selection }))
      return true
    })
    openModelPane()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /gpt-oss-120b/ }))
    await waitFor(() => { expect(select).toHaveBeenCalledWith({ provider: 'huggingface', model: 'openai/gpt-oss-120b' }) })

    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(copy('menu.route')) }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent)).toEqual([
      copy('route.fastest'), copy('route.cheapest'), copy('route.preferred'), 'groq', 'cerebras',
    ])
    fireEvent.click(screen.getByRole('menuitemradio', { name: copy('route.cheapest') }))
    await waitFor(() => {
      expect(select).toHaveBeenLastCalledWith({ provider: 'huggingface', model: 'openai/gpt-oss-120b:cheapest' })
    })
  })

  it('keeps a suffixed current selection matched to its listed model', () => {
    mount(state({ current: { provider: 'huggingface', model: 'openai/gpt-oss-120b:groq' } }))
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    expect(trigger.textContent).toContain('openai/gpt-oss-120b')
    openModelPane()
    expect(screen.getByRole('menuitemradio', { name: /gpt-oss-120b/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('accepts a typed model id and refuses one that is not org/name', async () => {
    const { select } = mount(state())
    openModelPane()
    const input = screen.getByRole('textbox', { name: copy('hf.idLabel') })
    fireEvent.change(input, { target: { value: 'not-a-model' } })
    fireEvent.click(screen.getByRole('button', { name: copy('hf.idUse') }))
    expect(screen.getByText(copy('hf.idInvalid'))).toBeTruthy()
    expect(select).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'someorg/new-model:together' } })
    fireEvent.click(screen.getByRole('button', { name: copy('hf.idUse') }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({ provider: 'huggingface', model: 'someorg/new-model:together' })
    })
  })

  it('localizes a router failure in the selection toast', async () => {
    const { directory, select } = mount(state())
    select.mockImplementation(async () => {
      directory.set(state({ status: 'error', error: '[huggingface:credits] Hugging Face credits are exhausted' }))
      return false
    })
    openModelPane()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Llama-3\.1/ }))
    const toast = await screen.findByRole('alert')
    expect(toast.textContent).toContain(copy('hf.error.credits'))
  })
})
