// @vitest-environment jsdom
/**
 * Chat failure copy for Hugging Face router failures: a `[huggingface:<kind>]`
 * tagged message renders the localized `hf.error.<kind>` text before the
 * generic AUTH replacement, so a gated model (403) is never reported as an
 * invalid API key. Every other failure renders exactly as before.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { ChatNodeViewProps, ModelRetryNode, TurnErrorNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { RetryNodeView, TurnErrorNodeView } from '../src/client/chat/MessageItem.tsx'
import { en, zh } from '../src/client/locale.ts'

afterEach(cleanup)

type Dictionary = Readonly<Record<string, string>>

function translate(dictionary: Dictionary): ChatNodeViewProps<'turn-error'>['t'] {
  return ((key: string, params?: Record<string, unknown>) => {
    const text = dictionary[key] ?? key
    return params === undefined ? text : text.replace(/\{(\w+)\}/gu, (_, name: string) => String(params[name]))
  }) as ChatNodeViewProps<'turn-error'>['t']
}

const turnError = (message: string, code?: string): TurnErrorNode => ({
  kind: 'turn-error', seq: 2, time: 2_000, turn: 1, step: 0, message,
  ...(code === undefined ? {} : { code }),
})

function renderTurnError(node: TurnErrorNode, dictionary: Dictionary): string {
  const props = { node: { data: node }, t: translate(dictionary) } as unknown as ChatNodeViewProps<'turn-error'>
  const view = render(<TurnErrorNodeView {...props} />)
  return view.getByRole('status').textContent ?? ''
}

const KINDS = ['unauthorized', 'credits', 'gated', 'notFound', 'rateLimited'] as const

describe('Hugging Face failure copy in chat', () => {
  it('ships every hf.error.<kind> key in en and zh', () => {
    for (const kind of KINDS) {
      expect(typeof (en as Dictionary)[`hf.error.${kind}`]).toBe('string')
      expect(typeof (zh as Dictionary)[`hf.error.${kind}`]).toBe('string')
    }
  })

  it('renders a gated 403 as the gated copy, never as an invalid API key', () => {
    const text = renderTurnError(
      turnError('[huggingface:gated] this model is gated; accept its license on huggingface.co', 'ACCESS_DENIED'),
      en,
    )
    expect(text).toContain((en as Dictionary)['hf.error.gated'])
    expect(text).not.toContain(en['message.failure.auth'])
    expect(text).not.toContain('[huggingface:')
  })

  it('prefers the tagged copy over the generic AUTH replacement, in zh too', () => {
    const text = renderTurnError(
      turnError('[huggingface:unauthorized] the Hugging Face token is invalid', 'AUTH'),
      zh,
    )
    expect(text).toContain((zh as Dictionary)['hf.error.unauthorized'])
    expect(text).not.toContain(zh['message.failure.auth'])
  })

  it('localizes a tagged failure on the retry row', () => {
    const retry: ModelRetryNode = {
      kind: 'model-retry', retryId: 'hf-retry' as ModelRetryNode['retryId'],
      seq: 3, time: 3_000, turn: 1, step: 0,
      retryState: 'cancelled',
      provider: 'huggingface', mode: 'normal', policyKey: 'huggingface-normal',
      retry: 1, maxRetries: 2, delayMs: 450,
      failure: { code: 'RATE_LIMIT', message: '[huggingface:rateLimited] Hugging Face is rate limiting this token' },
    }
    const props = {
      node: { data: { current: retry } },
      t: translate(en),
    } as unknown as ChatNodeViewProps<'model-retry'>
    const view = render(<RetryNodeView {...props} />)
    expect(view.container.textContent).toContain((en as Dictionary)['hf.error.rateLimited'])
    expect(view.container.textContent).not.toContain('[huggingface:')
  })

  it('renders non-Hugging Face failures exactly as before', () => {
    expect(renderTurnError(turnError('401 Unauthorized', 'AUTH'), en)).toBe(`${en['message.turnError']}${en['message.failure.auth']}AUTH`)
    cleanup()
    expect(renderTurnError(turnError('plugin exploded'), en)).toBe(`${en['message.turnError']}plugin exploded`)
    cleanup()
    expect(renderTurnError(turnError('[huggingface:bogus] unknown kind', 'PROVIDER_ERROR'), en))
      .toBe(`${en['message.turnError']}[huggingface:bogus] unknown kindPROVIDER_ERROR`)
  })
})
