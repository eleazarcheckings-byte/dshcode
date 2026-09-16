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
 * Fallback inflated-size cap used only when a caller (a direct unit test, or
 * any future caller) does not thread the plugin's real `maxFileBytes` cap
 * through {@link parsePdfDocument}. `applyReadPdfTool` always passes the
 * configured cap explicitly; see this module's doc comment.
 */
const DEFAULT_MAX_DECODED_BYTES = 32 * 1024 * 1024

/**
 * Decode a content stream's raw bytes per its `/Filter`. Only `FlateDecode`
 * and no filter (plain bytes) are supported; anything else fails loud with
 * `PDF_UNSUPPORTED_FILTER` naming the filter, rather than silently returning
 * compressed garbage as "text". `maxOutputBytes` bounds the INFLATED size —
 * `inflateSync`'s `maxOutputLength` aborts the expansion early once it is
 * reached (it does not allocate the full output first), so a highly
 * compressible stream inside the workspace cannot drive an unbounded
 * allocation before the byte-cap on the raw file ever applies.
 */
function decodeStreamText(rawLatin1: string, filter: string | undefined, displayPath: string, maxOutputBytes: number): string {
  if (filter === undefined) return rawLatin1
  if (filter === 'FlateDecode') {
    try {
      return inflateSync(Buffer.from(rawLatin1, 'latin1'), { maxOutputLength: maxOutputBytes }).toString('latin1')
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
 * Decode a hex string's digits (the content between `<` and `>`, whitespace
 * already stripped) into text, one byte per two hex digits. Per the PDF
 * spec, an odd trailing digit is the high nibble of a final byte whose low
 * nibble is 0. A non-hex-digit pair is skipped rather than thrown on — the
 * defensive-parsing posture this scanner already takes everywhere else.
 */
function decodeHexString(hex: string): string {
  let value = ''
  for (let i = 0; i < hex.length; i += 2) {
    const pair = i + 1 === hex.length ? `${hex[i]}0` : hex.slice(i, i + 2)
    const code = Number.parseInt(pair, 16)
    if (!Number.isNaN(code)) value += String.fromCharCode(code)
  }
  return value
}

/**
 * Extract shown text from one decoded content stream: `Tj`/`TJ`/`'`/`"`
 * operands (literal-string parentheses and hex strings — no inline dict/BDC
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
    // A hex string `<...>`, distinct from a `<<...>>` dict (an inline-image
    // or resource-dict operand this scanner otherwise leaves untouched).
    if (ch === '<' && content[index + 1] !== '<') {
      const closeIndex = content.indexOf('>', index + 1)
      if (closeIndex === -1) { index += 1; continue }
      pendingText += decodeHexString(content.slice(index + 1, closeIndex).replace(/\s+/gu, ''))
      index = closeIndex + 1
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
        if (content[cursor] === '<' && content[cursor + 1] !== '<') {
          const hexClose = content.indexOf('>', cursor + 1)
          if (hexClose === -1) { cursor += 1; continue }
          arrayText += decodeHexString(content.slice(cursor + 1, hexClose).replace(/\s+/gu, ''))
          cursor = hexClose + 1
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
      case "'":
      case '"':
        // `'` (string ') and `"` (aw ac string ") both move to the next line
        // THEN show the string — T* + Tj combined into one operator. The `"`
        // form's two leading numeric operands (word/char spacing) were
        // already swept up and dropped by the bare-word default case below.
        breakLine()
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
 * @param maxDecodedBytes - inclusive cap on one content stream's INFLATED size;
 *   defaults to {@link DEFAULT_MAX_DECODED_BYTES} for callers (unit tests, chiefly)
 *   that do not thread the plugin's configured `maxFileBytes` through explicitly.
 * @returns a document exposing `totalPages` and lazy per-page text extraction.
 */
export function parsePdfDocument(data: Uint8Array, displayPath: string, maxDecodedBytes = DEFAULT_MAX_DECODED_BYTES): PdfDocument {
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
      const decoded = decodeStreamText(streamObj.streamLatin1, filterOf(streamObj.dict), displayPath, maxDecodedBytes)
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

/**
 * Cap the selected pages' assembled text at `maxChars`, in ascending page
 * order (the model's read order). Once the running budget is exhausted, the
 * page in progress is cut with a marker naming how much was cut — the same
 * marker shape `read_notebook`'s `truncateOutput` uses — and every later
 * page is dropped rather than partially represented. Never splits a UTF-16
 * surrogate pair.
 * @param pages - the selected pages' extracted text, in ascending page order.
 * @param maxChars - the inclusive character budget across all selected pages.
 * @returns the (possibly shortened) page list and whether anything was cut.
 */
function truncatePages(pages: PdfPageText[], maxChars: number): { pages: PdfPageText[]; truncated: boolean } {
  let budget = maxChars
  const result: PdfPageText[] = []
  for (const page of pages) {
    if (budget <= 0) return { pages: result, truncated: true }
    if (page.text.length <= budget) {
      result.push(page)
      budget -= page.text.length
      continue
    }
    let cut = budget
    if (cut > 0 && page.text.charCodeAt(cut - 1) >= 0xD800 && page.text.charCodeAt(cut - 1) <= 0xDBFF) cut -= 1
    const omitted = page.text.length - cut
    result.push({ page: page.page, text: `${page.text.slice(0, cut)}\n... [truncated ${omitted} more character${omitted === 1 ? '' : 's'}]` })
    return { pages: result, truncated: true }
  }
  return { pages: result, truncated: false }
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

/** Caps for `read_pdf`: the shared document caps plus the assembled-text truncation cap. */
export interface PdfToolCaps extends DocumentToolCaps {
  /** Inclusive character cap on the selected pages' text, summed in ascending page order, before truncation. */
  maxTextChars: number
}

/**
 * Register the `read_pdf` tool into the given context.
 * @param ctx - the registration scope; execution uses its `fs` service.
 * @param caps - resolved plugin caps (workspace root, byte cap, assembled-text cap).
 */
export function applyReadPdfTool(ctx: Context, caps: PdfToolCaps): void {
  ctx.tools.register(defineTool({
    name: 'read_pdf',
    description: 'Read a PDF file and return extracted text for the requested pages, plus the total page count. '
      + 'Use the "pages" argument to select a single page ("2"), a range ("2-4"), or a comma-separated mix '
      + '("1,3-5"); omit it to read every page. Supports text-only PDFs (uncompressed or FlateDecode content '
      + 'streams); scanned/image-only PDFs return empty page text. A very large result is truncated with a '
      + 'marker naming how much text was cut.',
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
          truncated: { type: 'boolean' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatPdfReadOutput(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const { target, info } = await resolveWorkspaceDocument(ctx, exec, args.file_path, caps.workspaceRoot)
      const data = await ctx.fs.readBytes(target, exec.signal, caps.maxFileBytes)
      const document = parsePdfDocument(data, target.displayPath, caps.maxFileBytes)
      const selected = args.pages === undefined
        ? Array.from({ length: document.totalPages }, (_unused, position) => position + 1)
        : parsePageSelector(args.pages, document.totalPages)
      const pages: PdfPageText[] = selected.map(page => ({ page, text: document.pageText(page) }))
      const bounded = truncatePages(pages, caps.maxTextChars)
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
      const value: PdfReadValue = {
        path: target.displayPath,
        totalPages: document.totalPages,
        pages: bounded.pages,
        ...bounded.truncated ? { truncated: true } : {},
      }
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
