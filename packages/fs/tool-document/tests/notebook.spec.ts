/**
 * `read_notebook`: ordered cells with source and outputs over the real local
 * filesystem (cell/output shape, output-text truncation, malformed-JSON and
 * malformed-nbformat refusals, workspace confinement), plus focused unit
 * coverage of `parseNotebook`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as ToolDocument from '../src/index.ts'
import { DocumentError, formatNotebookReadOutput, parseNotebook } from '../src/index.ts'
import type { NotebookReadValue } from '../src/index.ts'

const FIXTURE = join(import.meta.dirname, 'fixtures', 'sample.ipynb')
const testSignal = new AbortController().signal

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-tool-document-notebook-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function setup(config: { workspaceRoot?: string; maxOutputChars?: number } = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin(LocalFileSystem, { cwd: dir })
  await ctx.plugin(ToolDocument, {
    workspaceRoot: config.workspaceRoot ?? dir,
    ...config.maxOutputChars === undefined ? {} : { maxOutputChars: config.maxOutputChars },
  })
  return ctx
}

let callCounter = 0
function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: testSignal,
    callId: ToolCallId(`nb-call-${++callCounter}`),
    name,
    arguments: args,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('parseNotebook against the committed fixture', () => {
  it('returns every cell in order with joined source, cell type, and (for code cells only) rendered outputs', async () => {
    const json = JSON.parse(await readFile(FIXTURE, 'utf8')) as unknown
    const value = parseNotebook(json, FIXTURE, 4000)
    expect(value.cellCount).toBe(6)
    expect(value.cells.map(c => c.cellType)).toEqual(['markdown', 'code', 'code', 'code', 'raw', 'code'])
    expect(value.cells.map(c => c.index)).toEqual([1, 2, 3, 4, 5, 6])

    expect(value.cells[0]!.source).toBe('# Title\nSome notes.')
    expect(value.cells[0]!.outputs).toEqual([])

    expect(value.cells[1]!.source).toBe("print('hello')\nprint('world')")
    expect(value.cells[1]!.outputs).toEqual([{ type: 'stream', text: 'hello\nworld\n' }])

    expect(value.cells[2]!.outputs).toEqual([{ type: 'execute_result', text: '2' }])

    expect(value.cells[3]!.outputs).toHaveLength(1)
    expect(value.cells[3]!.outputs[0]!.type).toBe('error')
    expect(value.cells[3]!.outputs[0]!.text).toBe(
      'ValueError: boom\n---------------------------------------------------------------------------\n'
      + 'Traceback (most recent call last):\nValueError: boom',
    )

    expect(value.cells[4]!.cellType).toBe('raw')
    expect(value.cells[4]!.source).toBe('raw content')
    expect(value.cells[4]!.outputs).toEqual([])
  })

  it('truncates a huge output with a marker naming the omitted character count', async () => {
    const json = JSON.parse(await readFile(FIXTURE, 'utf8')) as unknown
    const value = parseNotebook(json, FIXTURE, 4000)
    const huge = value.cells[5]!.outputs[0]!
    expect(huge.type).toBe('stream')
    expect(huge.truncated).toBe(true)
    expect(huge.text.length).toBeLessThan(6100)
    expect(huge.text.startsWith('x'.repeat(60))).toBe(true)
    expect(huge.text).toMatch(/\n\.\.\. \[truncated \d+ more characters]$/)
  })

  it('does not truncate when the cap is not exceeded', () => {
    const notebook = { cells: [{ cell_type: 'code', source: 'x', outputs: [{ output_type: 'stream', text: 'short' }] }] }
    const value = parseNotebook(notebook, 'x.ipynb', 4000)
    expect(value.cells[0]!.outputs[0]).toEqual({ type: 'stream', text: 'short' })
  })

  it('prefers text/plain and falls back to naming the first other mime type', () => {
    const value = parseNotebook({
      cells: [
        { cell_type: 'code', source: '', outputs: [{ output_type: 'display_data', data: { 'text/plain': 'hi' } }] },
        { cell_type: 'code', source: '', outputs: [{ output_type: 'display_data', data: { 'image/png': 'AAAA' } }] },
        { cell_type: 'code', source: '', outputs: [{ output_type: 'display_data', data: {} }] },
      ],
    }, 'x.ipynb', 4000)
    expect(value.cells[0]!.outputs[0]!.text).toBe('hi')
    expect(value.cells[1]!.outputs[0]!.text).toBe('[image/png output omitted]')
    expect(value.cells[2]!.outputs[0]!.text).toBe('[empty output]')
  })

  it.each([
    ['not an object', '[]'],
    ['object without cells', '{}'],
    ['cell missing cell_type', '{"cells":[{"source":"x"}]}'],
    ['cell with unrecognized cell_type', '{"cells":[{"cell_type":"weird","source":"x"}]}'],
    ['output missing output_type', '{"cells":[{"cell_type":"code","source":"x","outputs":[{}]}]}'],
    ['output with unrecognized output_type', '{"cells":[{"cell_type":"code","source":"x","outputs":[{"output_type":"weird"}]}]}'],
  ])('fails loud on %s', (_label, json) => {
    expect(() => parseNotebook(JSON.parse(json), 'x.ipynb', 4000)).toThrow(DocumentError)
    try {
      parseNotebook(JSON.parse(json), 'x.ipynb', 4000)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentError)
      expect((error as DocumentError).code).toBe('NOTEBOOK_PARSE_FAILED')
    }
  })
})

describe('formatNotebookReadOutput', () => {
  it('renders cellCount, headers per cell, and bracketed output-type labels', () => {
    const value: NotebookReadValue = {
      path: '/x.ipynb',
      cellCount: 2,
      cells: [
        { index: 1, cellType: 'markdown', source: '# hi', outputs: [] },
        { index: 2, cellType: 'code', source: '1', outputs: [{ type: 'execute_result', text: '1' }] },
      ],
    }
    expect(formatNotebookReadOutput(value)).toBe(
      '<path>/x.ipynb</path>\n<type>notebook</type>\n<content>\ncellCount: 2\n'
      + '--- cell 1 (markdown) ---\n# hi\n\n'
      + '--- cell 2 (code) ---\n1\n[execute_result]\n1\n</content>',
    )
  })
})

describe('read_notebook tool', () => {
  it('returns cells in order with source and outputs, and truncates the huge output', async () => {
    await writeFile(join(dir, 'nb.ipynb'), await readFile(FIXTURE))
    const ctx = await setup()
    const result = await call(ctx, 'read_notebook', { file_path: 'nb.ipynb' })
    expect(result.isError).toBe(false)
    const value = result.value as NotebookReadValue
    expect(value.cellCount).toBe(6)
    expect(value.cells.map(c => c.cellType)).toEqual(['markdown', 'code', 'code', 'code', 'raw', 'code'])
    expect(value.cells[5]!.outputs[0]!.truncated).toBe(true)
    expect(text(result)).toContain('cellCount: 6')
    expect(text(result)).toContain('[truncated')
  })

  it('fails loud on malformed JSON', async () => {
    await writeFile(join(dir, 'bad.ipynb'), '{not json')
    const ctx = await setup()
    const result = await call(ctx, 'read_notebook', { file_path: 'bad.ipynb' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('not valid UTF-8 JSON')
  })

  it('refuses a path outside the configured workspace root', async () => {
    await writeFile(join(dir, 'nb.ipynb'), await readFile(FIXTURE))
    const workspace = join(dir, 'inner')
    await mkdir(workspace)
    const ctx = await setup({ workspaceRoot: workspace })
    const result = await call(ctx, 'read_notebook', { file_path: join('..', 'nb.ipynb') })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('path is outside the workspace root')
  })

  it('rejects an empty path', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'read_notebook', { file_path: '' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('non-empty')
  })

  it('honors a configured maxOutputChars', async () => {
    await writeFile(join(dir, 'nb.ipynb'), JSON.stringify({
      cells: [{ cell_type: 'code', source: 'x', outputs: [{ output_type: 'stream', text: '0123456789' }] }],
    }))
    const ctx = await setup({ maxOutputChars: 5 })
    const result = await call(ctx, 'read_notebook', { file_path: 'nb.ipynb' })
    expect(result.isError).toBe(false)
    const value = result.value as NotebookReadValue
    expect(value.cells[0]!.outputs[0]!.truncated).toBe(true)
    expect(value.cells[0]!.outputs[0]!.text.startsWith('01234\n... [truncated')).toBe(true)
  })

  it('presents a read-family generic call card', async () => {
    const ctx = await setup()
    expect(ctx.tools.get('read_notebook')?.presentCall?.({ file_path: 'nb.ipynb' })).toEqual({
      card: 'generic',
      title: 'Read notebook nb.ipynb',
      kind: 'read',
      locations: [{ path: 'nb.ipynb' }],
    })
  })
})
