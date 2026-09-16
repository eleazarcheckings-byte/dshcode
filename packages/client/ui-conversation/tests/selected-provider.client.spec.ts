import { describe, expect, it } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  DEEPSEEK_PROVIDER_ID,
  isDeepSeekProvider,
  providerFromModelSelection,
  watchSelectedProvider,
} from '../src/client/skeleton/selected-provider.ts'

const SID = 'session-1' as SessionId

function listState(current: SessionId | undefined): SessionListState {
  return {
    ids: current === undefined ? [] : [current],
    byId: {},
    current,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

describe('isDeepSeekProvider', () => {
  it('accepts only the official DeepSeek adapter id', () => {
    expect(isDeepSeekProvider(DEEPSEEK_PROVIDER_ID)).toBe(true)
    expect(isDeepSeekProvider('openai')).toBe(false)
    expect(isDeepSeekProvider('deepseek')).toBe(false)
    expect(isDeepSeekProvider(null)).toBe(false)
    expect(isDeepSeekProvider(undefined)).toBe(false)
  })
})

describe('providerFromModelSelection', () => {
  it('prefers next over lastUsed, and treats empty snapshots as unknown', () => {
    expect(providerFromModelSelection(undefined)).toBeNull()
    expect(providerFromModelSelection({ lastUsed: null, next: null })).toBeNull()
    expect(providerFromModelSelection({
      lastUsed: { provider: 'openai', model: 'gpt' },
      next: { provider: DEEPSEEK_PROVIDER_ID, model: 'deepseek-flash' },
    })).toBe(DEEPSEEK_PROVIDER_ID)
    expect(providerFromModelSelection({
      lastUsed: { provider: 'openai', model: 'gpt' },
      next: null,
    })).toBe('openai')
  })
})

describe('watchSelectedProvider', () => {
  it('tracks the current session projection and clears when the session leaves', () => {
    const list = createSnapshotStore(listState(SID))
    const projection = createSnapshotStore<unknown>({
      lastUsed: null,
      next: { provider: DEEPSEEK_PROVIDER_ID, model: 'deepseek-flash' },
    })
    const sessions = {
      list,
      binding: (id: SessionId) => id === SID
        ? { session: { projections: { faceOf: () => projection } } }
        : undefined,
    } as unknown as Pick<ISessions, 'list' | 'binding'>
    const store = createSnapshotStore<string | null>(null)
    const stop = watchSelectedProvider(sessions, store)
    expect(store.getSnapshot()).toBe(DEEPSEEK_PROVIDER_ID)

    projection.set({ lastUsed: { provider: 'openai', model: 'gpt' }, next: { provider: 'openai', model: 'gpt' } })
    expect(store.getSnapshot()).toBe('openai')

    list.set(listState(undefined))
    expect(store.getSnapshot()).toBeNull()
    stop()
  })
})
