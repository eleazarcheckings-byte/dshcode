/**
 * Verb-first, present/past-tense tool row titles (2026-09-15
 * transcript-polish, recon/desktop-ux-audit.md R4 + SPEC §3 C2 item 4) — the
 * audit's own three named examples: Read → "Reading file…" / "Read file",
 * Grep → "Searching…" / "Searched", Bash → "Running…" / "Ran". A bare noun
 * ("读取"/"Bash") read as a debugger label, not a considered product voice.
 * Scoped deliberately to these three (see the deviations note in the cell
 * report) — write/edit/code/glob/pwsh/cordis-verb titles are unchanged.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { en, zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import { toolRowModel } from '../src/client/tool/models/tool-call-model.ts'
import { SearchRow } from '../src/client/tool/toolviews/search-row.tsx'

type SearchRowProps = Parameters<typeof SearchRow>[0]

afterEach(cleanup)

const tZh = makeTranslate(zh, commonZh)
const tEn = makeTranslate(en, commonZh)

const running = (name: string): RunningToolCall => ({
  callId: 'c1', name, argsRaw: '{}', turn: 1, step: 1, time: 1_000, subCalls: [],
})

const settled = (name: string): ToolResultNode => ({
  kind: 'tool-result', seq: 1, time: 2_000, callId: 'c1',
  call: { name, argsRaw: '{}' }, callTime: 1_000,
  content: [], isError: false, subCalls: [],
})

describe('bash title tense', () => {
  it('reads present tense while running, past tense once settled', () => {
    expect(tZh(toolRowModel('bash', running('bash')).titleKey)).toBe('执行中…')
    expect(tZh(toolRowModel('bash', settled('bash')).titleKey)).toBe('已执行')
    expect(tEn(toolRowModel('bash', running('bash')).titleKey)).toBe('Running…')
    expect(tEn(toolRowModel('bash', settled('bash')).titleKey)).toBe('Ran')
  })
})

describe('read title tense', () => {
  it('reads present tense while running, past tense once settled', () => {
    expect(tZh(toolRowModel('read', running('read')).titleKey)).toBe('读取文件中…')
    expect(tZh(toolRowModel('read', settled('read')).titleKey)).toBe('已读取文件')
    expect(tEn(toolRowModel('read', running('read')).titleKey)).toBe('Reading file…')
    expect(tEn(toolRowModel('read', settled('read')).titleKey)).toBe('Read file')
  })
})

describe('an error or interrupted row keeps the past-tense (settled) title', () => {
  it('bash', () => {
    const errored: ToolResultNode = { ...settled('bash'), isError: true }
    expect(tEn(toolRowModel('bash', errored).titleKey)).toBe('Ran')
  })
})

describe('grep title tense (SearchRow owns its title, not the variant fallback)', () => {
  const grepArgs = '{"pattern":"foo"}'
  const runningGrep: RunningToolCall = {
    callId: 'c1', name: 'grep', argsRaw: grepArgs, turn: 1, step: 1, time: 1_000, subCalls: [],
  }
  const settledGrepResult: ToolResultNode = {
    kind: 'tool-result', seq: 1, time: 2_000, callId: 'c1',
    call: { name: 'grep', argsRaw: grepArgs }, callTime: 1_000,
    content: [], isError: false, subCalls: [],
  }

  const rowProps = (block: RunningToolCall | ToolResultNode, toolName: string): SearchRowProps => ({
    callId: 'c1', toolName, block, t: tEn,
  } as unknown as SearchRowProps)

  it('reads present tense while running, past tense once settled', () => {
    const runningView = render(<SearchRow {...rowProps(runningGrep, 'grep')} />)
    expect(runningView.getByText('Searching…')).toBeTruthy()
    cleanup()
    const settledView = render(<SearchRow {...rowProps(settledGrepResult, 'grep')} />)
    expect(settledView.getByText('Searched')).toBeTruthy()
  })

  it('glob keeps its existing static label, unchanged', () => {
    const view = render(<SearchRow {...rowProps(settledGrepResult, 'glob')} />)
    expect(view.getByText('Glob')).toBeTruthy()
  })
})

describe('titles the audit did not name stay unchanged', () => {
  it('write/edit/code/glob/pwsh keep one label across running and settled', () => {
    expect(tEn(toolRowModel('write', running('write')).titleKey)).toBe('Write')
    expect(tEn(toolRowModel('write', settled('write')).titleKey)).toBe('Write')
    expect(tEn(toolRowModel('pwsh', running('pwsh')).titleKey)).toBe('Pwsh')
    expect(tEn(toolRowModel('pwsh', settled('pwsh')).titleKey)).toBe('Pwsh')
  })
})
