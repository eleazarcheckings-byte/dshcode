/**
 * `read_pdf`: page-ranged text extraction over the real local filesystem
 * (page selection, the out-of-range and malformed-selector refusals, the
 * content-stream text extractor, and workspace confinement), plus focused
 * unit coverage of the parsing helpers.
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
import {
  DocumentError,
  extractTextFromContentStream,
  formatPdfReadOutput,
  parsePageSelector,
  parsePdfDocument,
} from '../src/index.ts'

const FIXTURE = join(import.meta.dirname, 'fixtures', 'sample.pdf')
const testSignal = new AbortController().signal

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-tool-document-pdf-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function setup(workspaceRoot = dir) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin(LocalFileSystem, { cwd: dir })
  await ctx.plugin(ToolDocument, { workspaceRoot })
  return ctx
}

let callCounter = 0
function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: testSignal,
    callId: ToolCallId(`pdf-call-${++callCounter}`),
    name,
    arguments: args,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('parsePageSelector', () => {
  it('parses a single page, a range, and a comma-separated mix, de-duplicating and preserving ascending order', () => {
    expect(parsePageSelector('2', 5)).toEqual([2])
    expect(parsePageSelector('2-4', 5)).toEqual([2, 3, 4])
    expect(parsePageSelector('1,3-4,3,1', 5)).toEqual([1, 3, 4])
  })

  it.each([
    ['empty string', '   '],
    ['empty comma segment', '1,,2'],
    ['non-numeric token', 'two'],
    ['descending range', '4-2'],
    ['zero page', '0'],
  ])('rejects %s as PDF_PAGE_RANGE_INVALID', (_label, spec) => {
    expect(() => parsePageSelector(spec, 5)).toThrow(DocumentError)
    try {
      parsePageSelector(spec, 5)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentError)
      expect((error as DocumentError).code).toBe('PDF_PAGE_RANGE_INVALID')
    }
  })

  it('rejects a page beyond the document as PDF_PAGE_RANGE_OUT_OF_RANGE, naming the page count', () => {
    expect(() => parsePageSelector('4', 3)).toThrow('document has 3 pages, but "4" reaches page 4')
    try {
      parsePageSelector('2-4', 3)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentError)
      expect((error as DocumentError).code).toBe('PDF_PAGE_RANGE_OUT_OF_RANGE')
    }
  })
})

describe('extractTextFromContentStream', () => {
  it('extracts a single Tj string', () => {
    expect(extractTextFromContentStream('BT /F1 24 Tf 72 700 Td (Hello world) Tj ET')).toBe('Hello world')
  })

  it('breaks lines on Td/TD/T* and joins a TJ array of strings, ignoring numeric kerning operands', () => {
    const stream = 'BT (Line one) Tj 0 -20 Td [(Line )(two)] TJ T* (Line three) Tj ET'
    expect(extractTextFromContentStream(stream)).toBe('Line one\nLine two\nLine three')
  })

  it('decodes parenthesis/backslash escapes and octal escapes inside literal strings', () => {
    expect(extractTextFromContentStream('BT (a \\(b\\) c \\\\ d \\101) Tj ET')).toBe('a (b) c \\ d A')
  })

  it('decodes \\n/\\r/\\t escapes, drops an escaped end-of-line continuation, and keeps an unrecognized escape\'s literal char', () => {
    expect(extractTextFromContentStream('BT (a\\nb\\rc\\td\\z) Tj ET')).toBe('a\nb\rc\td' + 'z')
    expect(extractTextFromContentStream('BT (a\\\nb) Tj ET')).toBe('ab')
  })

  it('returns empty text for a stream with no text-showing operators', () => {
    expect(extractTextFromContentStream('q 1 0 0 1 0 0 cm 0 0 100 100 re f Q')).toBe('')
  })

  it('tolerates a stray boundary character outside any string (defensive parsing)', () => {
    expect(extractTextFromContentStream(') ] Tj ET')).toBe('')
  })
})

describe('parsePdfDocument against the committed fixture', () => {
  it('reports totalPages and extracts each page\'s text independently', async () => {
    const data = await readFile(FIXTURE)
    const document = parsePdfDocument(data, FIXTURE)
    expect(document.totalPages).toBe(3)
    expect(document.pageText(1)).toBe('Page one content, alpha.')
    expect(document.pageText(2)).toBe('Page two content, beta.')
    expect(document.pageText(3)).toBe('Page three content, gamma.\nSecond line')
  })

  it('rejects a page number outside the document via pageText', async () => {
    const data = await readFile(FIXTURE)
    const document = parsePdfDocument(data, FIXTURE)
    expect(() => document.pageText(4)).toThrow(DocumentError)
    try {
      document.pageText(0)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentError)
      expect((error as DocumentError).code).toBe('PDF_PAGE_RANGE_OUT_OF_RANGE')
    }
  })

  it('rejects bytes without a %PDF- header', () => {
    expect(() => parsePdfDocument(Buffer.from('not a pdf'), 'x.pdf')).toThrow('missing the %PDF- header')
  })

  it('wraps a corrupt FlateDecode stream as PDF_PARSE_FAILED, chaining the zlib failure as cause', () => {
    const body = Buffer.from(
      '%PDF-1.4\n'
      + '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
      + '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'
      + '3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n'
      + '4 0 obj\n<< /Length 5 /Filter /FlateDecode >>\nstream\nnotzlib\nendstream\nendobj\n',
      'latin1',
    )
    let caught: unknown
    try {
      parsePdfDocument(body, 'x.pdf').pageText(1)
    } catch (error: unknown) {
      caught = error
    }
    expect(caught).toBeInstanceOf(DocumentError)
    expect((caught as DocumentError).code).toBe('PDF_PARSE_FAILED')
    expect((caught as DocumentError).message).toContain('failed to inflate a FlateDecode content stream')
    expect((caught as DocumentError).cause).toBeInstanceOf(Error)
  })

  it('rejects an unsupported stream filter', () => {
    const body = Buffer.from(
      '%PDF-1.4\n'
      + '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
      + '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'
      + '3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n'
      + '4 0 obj\n<< /Length 3 /Filter /LZWDecode >>\nstream\nabc\nendstream\nendobj\n',
      'latin1',
    )
    expect(() => parsePdfDocument(body, 'x.pdf').pageText(1)).toThrow('unsupported PDF stream filter "/LZWDecode"')
  })
})

describe('parsePdfDocument page-tree error paths', () => {
  const HEADER = '%PDF-1.4\n'

  it.each([
    ['no Catalog object', `${HEADER}1 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n`, 'no PDF /Catalog object found'],
    ['Catalog missing /Pages', `${HEADER}1 0 obj\n<< /Type /Catalog >>\nendobj\n`, '/Catalog is missing /Pages'],
    [
      'Pages node with no /Kids',
      `${HEADER}1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 0 >>\nendobj\n`,
      'has no /Kids',
    ],
    [
      'Pages tree referencing a missing object',
      `${HEADER}1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [9 0 R] /Count 1 >>\nendobj\n`,
      'references missing object 9',
    ],
    [
      'Pages tree child of an unexpected type',
      `${HEADER}1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] `
      + '/Count 1 >>\nendobj\n3 0 obj\n<< /Type /Font >>\nendobj\n',
      'is neither /Pages nor /Page',
    ],
    [
      'a self-referential Pages cycle',
      `${HEADER}1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [2 0 R] /Count 1 >>\nendobj\n`,
      'page tree contains a cycle',
    ],
  ])('fails loud on %s', (_label, pdf, expected) => {
    expect(() => parsePdfDocument(Buffer.from(pdf, 'latin1'), 'x.pdf')).toThrow(expected)
  })

  it('joins multiple /Contents streams for one page and skips an empty one', () => {
    const pdf = `${HEADER}`
      + '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
      + '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'
      + '3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents [4 0 R 5 0 R] >>\nendobj\n'
      + '4 0 obj\n<< /Length 21 >>\nstream\nBT (First) Tj ET\nendstream\nendobj\n'
      + '5 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n'
    const document = parsePdfDocument(Buffer.from(pdf, 'latin1'), 'x.pdf')
    expect(document.totalPages).toBe(1)
    expect(document.pageText(1)).toBe('First')
  })

  it('fails loud when a page\'s /Contents object has no stream', () => {
    const pdf = `${HEADER}`
      + '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
      + '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'
      + '3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n'
      + '4 0 obj\n<< /Type /Font >>\nendobj\n'
    expect(() => parsePdfDocument(Buffer.from(pdf, 'latin1'), 'x.pdf').pageText(1)).toThrow('content stream (object 4) is missing')
  })
})

describe('read_pdf tool', () => {
  it('returns only the requested page\'s text and the true totalPages', async () => {
    await copyFixtureInto(dir, 'sample.pdf')
    const ctx = await setup()
    const result = await call(ctx, 'read_pdf', { file_path: 'sample.pdf', pages: '2' })
    expect(result.isError).toBe(false)
    const value = result.value as { path: string; totalPages: number; pages: { page: number; text: string }[] }
    expect(value.totalPages).toBe(3)
    expect(value.pages).toEqual([{ page: 2, text: 'Page two content, beta.' }])
    expect(text(result)).toContain('totalPages: 3')
    expect(text(result)).toContain('--- page 2 ---\nPage two content, beta.')
    expect(text(result)).not.toContain('alpha')
  })

  it('reads every page when "pages" is omitted', async () => {
    await copyFixtureInto(dir, 'sample.pdf')
    const ctx = await setup()
    const result = await call(ctx, 'read_pdf', { file_path: 'sample.pdf' })
    expect(result.isError).toBe(false)
    const value = result.value as { pages: { page: number }[] }
    expect(value.pages.map(p => p.page)).toEqual([1, 2, 3])
  })

  it('fails loud, naming the page count, for an out-of-range page request', async () => {
    await copyFixtureInto(dir, 'sample.pdf')
    const ctx = await setup()
    const result = await call(ctx, 'read_pdf', { file_path: 'sample.pdf', pages: '5' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('document has 3 pages')
  })

  it('fails loud for a malformed pages selector', async () => {
    await copyFixtureInto(dir, 'sample.pdf')
    const ctx = await setup()
    const result = await call(ctx, 'read_pdf', { file_path: 'sample.pdf', pages: 'nope' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('is not a page number or a "start-end" range')
  })

  it('refuses a path outside the configured workspace root', async () => {
    await copyFixtureInto(dir, 'sample.pdf')
    const outside = await mkdtemp(join(tmpdir(), 'dsh-tool-document-outside-'))
    try {
      const workspace = join(dir, 'workspace')
      await mkdir(workspace)
      const ctx = await setup(workspace)
      const result = await call(ctx, 'read_pdf', { file_path: join('..', 'sample.pdf') })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('path is outside the workspace root')

      const absoluteEscape = await call(ctx, 'read_pdf', { file_path: join(outside, 'x.pdf') })
      expect(absoluteEscape.isError).toBe(true)
      expect(text(absoluteEscape)).toContain('path is outside the workspace root')
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('reports a missing file and a directory target through the document vocabulary', async () => {
    await mkdir(join(dir, 'adir.pdf'))
    const ctx = await setup()
    const missing = await call(ctx, 'read_pdf', { file_path: 'absent.pdf' })
    expect(missing.isError).toBe(true)
    expect(text(missing)).toContain('not found')

    const directory = await call(ctx, 'read_pdf', { file_path: 'adir.pdf' })
    expect(directory.isError).toBe(true)
    expect(text(directory)).toContain('not a regular file')
  })

  it('rejects an empty path', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'read_pdf', { file_path: '   ' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('non-empty')
  })

  it('presents a read-family generic call card naming the page selection', async () => {
    const ctx = await setup()
    expect(ctx.tools.get('read_pdf')?.presentCall?.({ file_path: 'a.pdf', pages: '2-3' })).toEqual({
      card: 'generic',
      title: 'Read PDF a.pdf (2-3)',
      kind: 'read',
      locations: [{ path: 'a.pdf' }],
    })
    expect(ctx.tools.get('read_pdf')?.presentCall?.({ file_path: 'a.pdf' })).toEqual({
      card: 'generic',
      title: 'Read PDF a.pdf',
      kind: 'read',
      locations: [{ path: 'a.pdf' }],
    })
  })
})

describe('formatPdfReadOutput', () => {
  it('renders totalPages and every selected page under its own heading', () => {
    const pages = [{ page: 1, text: 'a' }, { page: 2, text: 'b' }]
    const rendered = formatPdfReadOutput({ path: '/x.pdf', totalPages: 2, pages })
    expect(rendered).toBe(
      '<path>/x.pdf</path>\n<type>pdf</type>\n<content>\ntotalPages: 2\n--- page 1 ---\na\n\n--- page 2 ---\nb\n</content>',
    )
  })
})

async function copyFixtureInto(targetDir: string, name: string): Promise<void> {
  await writeFile(join(targetDir, name), await readFile(FIXTURE))
}
