// @vitest-environment jsdom
/**
 * Per-row elapsed duration (2026-09-15 transcript-polish, SPEC §3 C2 item 4):
 * a settled call's `time - callTime` renders beside the title, matching the
 * message footer's "Ran for Xs" style; a running call (no settlement yet) or
 * one whose paired call fell outside the loaded window (`callTime: null`)
 * shows no duration at all — never a stale or fabricated number.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import { formatToolDuration, toolRowModel } from '../src/client/tool/models/tool-call-model.ts'
import { ToolRow, type ToolRowProps } from '../src/client/tool/components/ToolRow.tsx'

afterEach(cleanup)

const t: ToolRowProps['t'] = makeTranslate(zh, commonZh)

const running: RunningToolCall = {
  callId: 'c1', name: 'bash', argsRaw: '{"command":"ls"}', turn: 1, step: 1, time: 1_000, subCalls: [],
}

const settled = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 1, time: 13_400, callId: 'c1',
  call: { name: 'bash', argsRaw: '{"command":"ls"}' },
  callTime: 1_000,
  content: [], isError: false, subCalls: [], ...over,
})

describe('toolRowModel duration', () => {
  it('is null while running', () => {
    expect(toolRowModel('bash', running).durationMs).toBeNull()
  })

  it('is the settled wall-clock span, clamped at zero', () => {
    expect(toolRowModel('bash', settled()).durationMs).toBe(12_400)
    expect(toolRowModel('bash', settled({ time: 500, callTime: 1_000 })).durationMs).toBe(0)
  })

  it('is null when the paired call fell outside the loaded window', () => {
    expect(toolRowModel('bash', settled({ callTime: null })).durationMs).toBeNull()
  })
})

describe('formatToolDuration', () => {
  it('renders whole seconds under a minute', () => {
    expect(formatToolDuration(12_400, t)).toBe('12秒')
  })

  it('renders minutes and zero-padded seconds beyond a minute', () => {
    expect(formatToolDuration(65_000, t)).toBe('1分05秒')
  })
})

describe('ToolRow duration rendering', () => {
  const rowProps: ToolRowProps = {
    t, variant: 'bash', icon: <i />, title: 'Ran', summary: 'ls', state: 'ok',
  }

  it('shows the formatted duration beside the title when settled', () => {
    const view = render(<ToolRow {...rowProps} duration={12_400} />)
    expect(view.getByText('12秒')).toBeTruthy()
  })

  it('renders nothing when duration is null or absent', () => {
    const view = render(<ToolRow {...rowProps} duration={null} />)
    expect(view.container.querySelector('[class*="duration"]')).toBeNull()
    const viewAbsent = render(<ToolRow {...rowProps} />)
    expect(viewAbsent.container.querySelector('[class*="duration"]')).toBeNull()
  })

  it('still shows the summary separator when a duration is also present', () => {
    const view = render(<ToolRow {...rowProps} duration={3_000} />)
    expect(view.getByText('3秒')).toBeTruthy()
    expect(view.getByText('ls')).toBeTruthy()
  })
})
