/**
 * The model-facing `read_pdf` tool: page-ranged text extraction plus page
 * count for PDF files, the first of the two formats Claude Code reads
 * natively that this harness could not open before this package.
 *
 * No maintained PDF text extractor is vendored in this workspace (checked:
 * no `pdfjs*`/`pdf-parse*`/`unpdf*` under `node_modules`), so this module
 * implements a minimal in-tree extractor rather than leaving `read_pdf`
 * unimplemented. It is deliberately narrow: single-revision PDFs (the common
 * case for a generated or exported document) whose page text lives in
 * `Tj`/`TJ` operators inside `FlateDecode`-or-uncompressed content streams.
 * It does not parse the cross-reference table (objects are found by scanning
 * for `N 0 obj … endobj`, which tolerates a stale or absent xref the way real
 * PDF viewers' fallback scanners do), does not resolve encryption, object
 * streams, cross-reference streams, or `ToUnicode` CMaps, and assumes
 * Latin-1-compatible simple-font text. See the package README's Known
 * Limitations section for the full list and the upgrade path (swap in a real
 * extractor library once one is vendored).
 * @module @deepseek-ai/dsh-tool-document/pdf
 */

import { inflateSync } from 'node:zlib'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type { PdfPageText, PdfReadValue } from './types.ts'
import { DocumentError } from './error.ts'
import type { DocumentToolCaps } from './workspace.ts'
import { resolveWorkspaceDocument } from './workspace.ts'

/** One `N 0 obj … endobj` object body, split at its optional stream section. */
interface PdfObject {
  /** The dictionary text (before `stream`, or the whole body for a non-stream object). */
  dict: string
  /** Raw stream bytes, Latin-1-decoded 1:1 from the source bytes; `undefined` for a non-stream object. */
  streamLatin1?: string
}

/** A parsed PDF ready for page-text extraction. */
export interface PdfDocument {
  totalPages: number
  /** Extract page `page`'s text (1-based); throws `PDF_PAGE_RANGE_OUT_OF_RANGE` outside `[1, totalPages]`. */
  pageText(page: number): string
}

/**
 * Scan `N 0 obj … endobj` objects out of a whole-file Latin-1 string, keyed
 * by object number. Deliberately not xref-driven: {@link parsePdfDocument}'s
 * doc comment explains why.
 * @param latin1 - the whole file, decoded 1:1 from raw bytes via Latin-1.
 * @returns every found object, keyed by its object number (later duplicates in file order win).
 */
function parsePdfObjects(latin1: string): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>()
  const objectPattern = /(\d+)\s+\d+\s+obj([\s\S]*?)endobj/g
  for (const match of latin1.matchAll(objectPattern)) {
    const num = Number(match[1])
    const body = match[2] ?? ''
    const streamMatch = /^([\s\S]*?)stream\r?\n([\s\S]*?)\r?\nendstream/.exec(body)
    objects.set(num, streamMatch === null
      ? { dict: body }
      : { dict: streamMatch[1] ?? '', streamLatin1: streamMatch[2] ?? '' })
  }
  return objects
}

function typeOf(dict: string): string | undefined {
  return /\/Type\s*\/(\w+)/.exec(dict)?.[1]
}

function singleRef(dict: string, key: string): number | undefined {
  const match = new RegExp(String.raw`/${key}\s+(\d+)\s+0\s+R`).exec(dict)
  return match?.[1] === undefined ? undefined : Number(match[1])
}

/** Refs out of `/Key N 0 R` or `/Key [N 0 R M 0 R …]`, in array order. */
function refList(dict: string, key: string): number[] {
  const arrayMatch = new RegExp(String.raw`/${key}\s*\[([^\]]*)\]`).exec(dict)
  if (arrayMatch !== null) {
    return [...(arrayMatch[1] ?? '').matchAll(/(\d+)\s+0\s+R/g)].map(m => Number(m[1]))
  }
  const single = singleRef(dict, key)
  return single === undefined ? [] : [single]
}

function filterOf(dict: string): string | undefined {
  return /\/Filter\s*\/(\w+)/.exec(dict)?.[1]
}

/**
 * Decode a content stream's raw bytes per its `/Filter`. Only `FlateDecode`
 * and no filter (plain bytes) are supported; anything else fails loud with
 * `PDF_UNSUPPORTED_FILTER` naming the filter, rather than silently returning
 * compressed garbage as "text".
 */
function decodeStreamText(rawLatin1: string, filter: string | undefined, displayPath: string): string {
  if (filter === undefined) return rawLatin1
  if (filter === 'FlateDecode') {
    try {
      return inflateSync(Buffer.from(rawLatin1, 'latin1')).toString('latin1')
    } catch (error: unknown) {
      throw new DocumentError(
        `cannot read "${displayPath}": failed to inflate a FlateDecode content stream`,
        'PDF_PARSE_FAILED',
        { cause: error },
      )
    }
  }
  throw new DocumentError(`cannot read "${displayPath}": unsupported PDF stream filter "/${filter}"`, 'PDF_UNSUPPORTED_FILTER')
}

/** `\ddd` octal, `\n`/`\r`/`\t`, escaped `(`/`)`/`\`, an escaped end-of-line (dropped), and literal bytes. */
function readLiteralString(content: string, openParen: number): { value: string; next: number } {
  let depth = 1
  let index = openParen + 1
  let value = ''
  while (index < content.length && depth > 0) {
    // The while condition already guarantees index < content.length here.
    const ch = content[index] ?? ''
    if (ch === '\\') {
      const next = content[index + 1]
      if (next === 'n') { value += '\n'; index += 2; continue }
      if (next === 'r') { value += '\r'; index += 2; continue }
      if (next === 't') { value += '\t'; index += 2; continue }
      if (next === '(' || next === ')' || next === '\\') { value += next; index += 2; continue }
      if (next === '\n') { index += 2; continue }
      const octal = /^[0-7]{1,3}/.exec(content.slice(index + 1, index + 4))
      if (octal !== null) {
        value += String.fromCharCode(Number.parseInt(octal[0], 8))
        index += 1 + octal[0].length
        continue
      }
      // Unrecognized escape: PDF spec says drop the backslash and keep the literal char.
      value += next ?? ''
      index += 2
      continue
    }
    if (ch === '(') { depth += 1; value += ch; index += 1; continue }
    if (ch === ')') {
      depth -= 1
      index += 1
      if (depth > 0) value += ch
      continue
    }
    value += ch
    index += 1
  }
  return { value, next: index }
}

const OPERAND_BOUNDARY = /[\s()[\]]/u

/**
 * Extract shown text from one decoded content stream: `Tj` and `TJ` operands
 * (literal-string parentheses only — no hex strings, no inline dict/BDC
 * skipping), with `Td`/`TD`/`T*` treated as line breaks and `BT`/`ET`
 * bracketing one text object. Every other operator (font, color, graphics
 * state, positioning numbers, resource names) is inert: its operands are
 * dropped, unconsumed, before the next text-showing operator.
 */
export function extractTextFromContentStream(content: string): string {
  const lines: string[] = []
  let current = ''
  let pendingText = ''
  let index = 0

  function breakLine(): void {
    if (current.length > 0) {
      lines.push(current)
      current = ''
    }
  }

  while (index < content.length) {
    const ch = content[index]
    if (ch === '(') {
      const { value, next } = readLiteralString(content, index)
      pendingText += value
      index = next
      continue
    }
    if (ch === '[') {
      let cursor = index + 1
      let arrayText = ''
      while (cursor < content.length && content[cursor] !== ']') {
        if (content[cursor] === '(') {
          const { value, next } = readLiteralString(content, cursor)
          arrayText += value
          cursor = next
          continue
        }
        cursor += 1
      }
      pendingText += arrayText
      index = cursor + 1
      continue
    }
    if (ch !== undefined && /\s/u.test(ch)) { index += 1; continue }
    let end = index
    while (end < content.length) {
      const boundaryChar = content[end]
      if (boundaryChar !== undefined && OPERAND_BOUNDARY.test(boundaryChar)) break
      end += 1
    }
    const word = end === index ? (content[index] ?? '') : content.slice(index, end)
    index = end === index ? index + 1 : end
    switch (word) {
      case 'Tj':
      case 'TJ':
        current += pendingText
        pendingText = ''
        break
      case 'Td':
      case 'TD':
      case 'T*':
      case 'ET':
        // Each starts a new displayed line; ET additionally closes the text object,
        // but nothing later reads that distinction, so the two collapse to one line break.
        breakLine()
        pendingText = ''
        break
      case 'BT':
        current = ''
        pendingText = ''
        break
      default:
        // A non-text-showing operator or a bare numeric/name operand: no effect on shown text.
        break
    }
  }
  breakLine()
  return lines.join('\n')
}

/** Depth-first leaf `/Page` objects under a `/Pages` (or bare `/Page`) node, in `/Kids` order. */
function collectPageObjects(objects: Map<number, PdfObject>, nodeNum: number, displayPath: string, seen: Set<number>): PdfObject[] {
  if (seen.has(nodeNum)) {
    throw new DocumentError(`cannot read "${displayPath}": PDF page tree contains a cycle at object ${nodeNum}`, 'PDF_PARSE_FAILED')
  }
  seen.add(nodeNum)
  const node = objects.get(nodeNum)
  if (node === undefined) {
    throw new DocumentError(`cannot read "${displayPath}": PDF page tree references missing object ${nodeNum}`, 'PDF_PARSE_FAILED')
  }
  const type = typeOf(node.dict)
  if (type === 'Page') return [node]
  if (type === 'Pages') {
    const kids = refList(node.dict, 'Kids')
    if (kids.length === 0) {
      throw new DocumentError(`cannot read "${displayPath}": PDF /Pages object ${nodeNum} has no /Kids`, 'PDF_PARSE_FAILED')
    }
    return kids.flatMap(kid => collectPageObjects(objects, kid, displayPath, seen))
  }
  throw new DocumentError(
    `cannot read "${displayPath}": object ${nodeNum} in the PDF page tree is neither /Pages nor /Page`,
    'PDF_PARSE_FAILED',
  )
}

/**
 * Parse a PDF's page tree and content streams. See this module's doc comment
 * for the supported subset.
 * @param data - the whole file's raw bytes.
 * @param displayPath - the backend-resolved path rendered in error messages.
 * @returns a document exposing `totalPages` and lazy per-page text extraction.
 */
export function parsePdfDocument(data: Uint8Array, displayPath: string): PdfDocument {
  const latin1 = Buffer.from(data).toString('latin1')
  if (!latin1.startsWith('%PDF-')) {
    throw new DocumentError(`cannot read "${displayPath}": not a PDF file (missing the %PDF- header)`, 'PDF_PARSE_FAILED')
  }
  const objects = parsePdfObjects(latin1)
  const catalogEntry = [...objects.entries()].find(([, obj]) => typeOf(obj.dict) === 'Catalog')
  if (catalogEntry === undefined) {
    throw new DocumentError(`cannot read "${displayPath}": no PDF /Catalog object found`, 'PDF_PARSE_FAILED')
  }
  const pagesRoot = singleRef(catalogEntry[1].dict, 'Pages')
  if (pagesRoot === undefined) {
    throw new DocumentError(`cannot read "${displayPath}": PDF /Catalog is missing /Pages`, 'PDF_PARSE_FAILED')
  }
  const pageObjects = collectPageObjects(objects, pagesRoot, displayPath, new Set())

  function pageText(page: number): string {
    const pageObj = pageObjects[page - 1]
    if (pageObj === undefined) {
      const noun = pageObjects.length === 1 ? 'page' : 'pages'
      throw new DocumentError(
        `cannot read "${displayPath}": page ${page} does not exist (document has ${pageObjects.length} ${noun})`,
        'PDF_PAGE_RANGE_OUT_OF_RANGE',
      )
    }
    const contentNums = refList(pageObj.dict, 'Contents')
    const parts = contentNums.map((num) => {
      const streamObj = objects.get(num)
      if (streamObj?.streamLatin1 === undefined) {
        throw new DocumentError(
          `cannot read "${displayPath}": page ${page}'s content stream (object ${num}) is missing`,
          'PDF_PARSE_FAILED',
        )
      }
      const decoded = decodeStreamText(streamObj.streamLatin1, filterOf(streamObj.dict), displayPath)
      return extractTextFromContentStream(decoded)
    })
    return parts.filter(part => part.length > 0).join('\n')
  }

  return { totalPages: pageObjects.length, pageText }
}

/**
 * Parse a `pages` selector (`"2"`, `"1,3"`, `"2-4"`, or a comma-separated mix)
 * into an ascending, de-duplicated 1-based page-number list.
 * @param spec - the raw `pages` argument.
 * @param totalPages - the document's page count, for range validation.
 * @throws {DocumentError} `PDF_PAGE_RANGE_INVALID` for malformed syntax; `PDF_PAGE_RANGE_OUT_OF_RANGE` for a page beyond `totalPages`.
 */
export function parsePageSelector(spec: string, totalPages: number): number[] {
  const trimmed = spec.trim()
  if (trimmed.length === 0) {
    throw new DocumentError('pages must be a non-empty string', 'PDF_PAGE_RANGE_INVALID')
  }
  const seen = new Set<number>()
  const result: number[] = []
  for (const rawPart of trimmed.split(',')) {
    const token = rawPart.trim()
    if (token.length === 0) {
      throw new DocumentError(`invalid pages selector "${spec}": empty segment between commas`, 'PDF_PAGE_RANGE_INVALID')
    }
    const rangeMatch = /^(\d+)-(\d+)$/.exec(token)
    let start: number
    let end: number
    if (rangeMatch !== null) {
      start = Number(rangeMatch[1])
      end = Number(rangeMatch[2])
    } else if (/^\d+$/.test(token)) {
      start = Number(token)
      end = start
    } else {
      throw new DocumentError(
        `invalid pages selector "${spec}": "${token}" is not a page number or a "start-end" range`,
        'PDF_PAGE_RANGE_INVALID',
      )
    }
    if (start < 1 || end < start) {
      throw new DocumentError(
        `invalid pages selector "${spec}": "${token}" is not a valid ascending 1-based range`,
        'PDF_PAGE_RANGE_INVALID',
      )
    }
    if (end > totalPages) {
      throw new DocumentError(
        `cannot read pages "${spec}": document has ${totalPages} page${totalPages === 1 ? '' : 's'}, but "${token}" reaches page ${end}`,
        'PDF_PAGE_RANGE_OUT_OF_RANGE',
      )
    }
    for (let page = start; page <= end; page += 1) {
      if (!seen.has(page)) {
        seen.add(page)
        result.push(page)
      }
    }
  }
  return result
}

/** Format one `read_pdf` outcome as the model-facing envelope. */
export function formatPdfReadOutput(value: PdfReadValue): string {
  const body = value.pages.map(({ page, text }) => `--- page ${page} ---\n${text}`).join('\n\n')
  return `<path>${value.path}</path>
<type>pdf</type>
<content>
totalPages: ${value.totalPages}
${body}
</content>`
}

const PDF_PAGE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', required: true },
    text: { type: 'string', required: true },
  },
} as const

/**
 * Register the `read_pdf` tool into the given context.
 * @param ctx - the registration scope; execution uses its `fs` service.
 * @param caps - resolved plugin caps (workspace root + byte cap).
 */
export function applyReadPdfTool(ctx: Context, caps: DocumentToolCaps): void {
  ctx.tools.register(defineTool({
    name: 'read_pdf',
    description: 'Read a PDF file and return extracted text for the requested pages, plus the total page count. '
      + 'Use the "pages" argument to select a single page ("2"), a range ("2-4"), or a comma-separated mix '
      + '("1,3-5"); omit it to read every page. Supports text-only PDFs (uncompressed or FlateDecode content '
      + 'streams); scanned/image-only PDFs return empty page text.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to the PDF file, resolved by the filesystem backend.' },
      pages: {
        type: 'string',
        description: 'Pages to read: a 1-based page number, a "start-end" range, or a comma-separated mix. Defaults to every page.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          totalPages: { type: 'integer', required: true },
          pages: { type: 'array', required: true, items: PDF_PAGE_VALUE_SCHEMA },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatPdfReadOutput(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const { target, info } = await resolveWorkspaceDocument(ctx, exec, args.file_path, caps.workspaceRoot)
      const data = await ctx.fs.readBytes(target, exec.signal, caps.maxFileBytes)
      const document = parsePdfDocument(data, target.displayPath)
      const selected = args.pages === undefined
        ? Array.from({ length: document.totalPages }, (_unused, position) => position + 1)
        : parsePageSelector(args.pages, document.totalPages)
      const pages: PdfPageText[] = selected.map(page => ({ page, text: document.pageText(page) }))
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
      const value: PdfReadValue = { path: target.displayPath, totalPages: document.totalPages, pages }
      return value
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Read PDF ${args.file_path}${args.pages === undefined ? '' : ` (${args.pages})`}`,
        kind: 'read',
        locations: [{ path: args.file_path }],
      }
    },
  }))
}
