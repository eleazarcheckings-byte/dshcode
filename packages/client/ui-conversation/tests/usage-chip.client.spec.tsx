// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn, zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/index.ts'
import { UsageChip, type UsageChipProps } from '../src/client/skeleton/UsageChip.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh) as UsageChipProps['t']
const tEn = makeTranslate(en, commonEn) as UsageChipProps['t']

function projections(values: Record<string, unknown>): UsageChipProps['useProjection'] {
  return (key: string) => values[key]
}

function chip(values: Record<string, unknown>, translate: UsageChipProps['t'] = t) {
  return render(<UsageChip useProjection={projections(values)} t={translate} />)
}

describe('UsageChip', () => {
  it('renders nothing until the session has real token-meter usage', () => {
    expect(chip({}).container.textContent).toBe('')
    expect(chip({
      tokenUsage: {
        uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      },
    }).container.textContent).toBe('')
  })

  it('shows compact in/out totals from the durable tokenUsage projection', () => {
    const view = chip({
      tokenUsage: {
        uncachedInputTokens: 12_000,
        outputTokens: 3_100,
        cacheReadTokens: 400,
        cacheWriteTokens: 0,
      },
    }, tEn)
    const node = view.container.querySelector('[data-usage-chip]')
    expect(node).not.toBeNull()
    expect(node?.textContent).toBe('12.4K in · 3.1K out')
    expect(node?.getAttribute('aria-label')).toBe('This session: 12.4K input, 3.1K output')
    expect(view.container.querySelector('[class*="bar"]')).toBeNull()
    expect(view.container.textContent).not.toMatch(/\$/)
  })

  it('lets each locale own the in/out sentence', () => {
    const values = {
      tokenUsage: {
        uncachedInputTokens: 80, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0,
      },
    }
    expect(chip(values).getByLabelText('本会话用量：输入 80，输出 20').textContent)
      .toBe('80 入 · 20 出')
    expect(chip(values, tEn).getByLabelText('This session: 80 input, 20 output').textContent)
      .toBe('80 in · 20 out')
  })
})
