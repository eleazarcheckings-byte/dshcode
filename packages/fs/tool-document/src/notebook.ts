/**
 * The model-facing `read_notebook` tool: ordered cells with source and
 * outputs for Jupyter (nbformat 4) notebooks, the second of the two file
 * types Claude Code reads natively that this harness could not open before
 * this package.
 * @module @deepseek-ai/dsh-tool-document/notebook
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type { NotebookCellType, NotebookCellValue, NotebookOutputText, NotebookOutputType, NotebookReadValue } from './types.ts'
import { DocumentError } from './error.ts'
import type { DocumentToolCaps } from './workspace.ts'
import { resolveWorkspaceDocument } from './workspace.ts'

/** Caps for `read_notebook`: the shared document caps plus the per-output truncation cap. */
export interface NotebookToolCaps extends DocumentToolCaps {
  /** Inclusive character cap on one rendered output's text before truncation. */
  maxOutputChars: number
}

const CELL_TYPES: readonly NotebookCellType[] = ['code', 'markdown', 'raw']
const OUTPUT_TYPES: readonly NotebookOutputType[] = ['stream', 'execute_result', 'display_data', 'error']

/** ANSI SGR escape sequences (color/style), as Jupyter error tracebacks commonly embed them. */
const ANSI_ESCAPE = /\[[0-9;]*m/gu

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '')
}

/** nbformat `source`/`text` fields are a string or an array of strings joined with no added separator. */
function joinSource(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(part => (typeof part === 'string' ? part : '')).join('')
  return ''
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Cap `text` at `maxChars`, appending a marker naming how much was cut. Never
 * splits a UTF-16 surrogate pair.
 */
function truncateOutput(text: string, maxChars: number): { text: string; truncated?: boolean } {
  if (text.length <= maxChars) return { text }
  let cut = maxChars
  // Avoid slicing between a surrogate pair's high and low halves.
  if (cut > 0 && text.charCodeAt(cut - 1) >= 0xD800 && text.charCodeAt(cut - 1) <= 0xDBFF) cut -= 1
  const omitted = text.length - cut
  return { text: `${text.slice(0, cut)}\n... [truncated ${omitted} more character${omitted === 1 ? '' : 's'}]`, truncated: true }
}

/**
 * Render one nbformat output object into model-facing text.
 * @param raw - the raw output object from `cell.outputs`.
 * @param cellIndex - 1-based cell position, for error messages.
 * @param maxChars - the truncation cap (see {@link NotebookToolCaps.maxOutputChars}).
 * @param displayPath - the backend-resolved path, for error messages.
 */
function renderOutput(raw: unknown, cellIndex: number, maxChars: number, displayPath: string): NotebookOutputText {
  if (!isPlainObject(raw) || typeof raw.output_type !== 'string') {
    throw new DocumentError(
      `cannot read "${displayPath}": cell ${cellIndex} has a malformed output (missing "output_type")`,
      'NOTEBOOK_PARSE_FAILED',
    )
  }
  const outputType = raw.output_type
  if (!(OUTPUT_TYPES as readonly string[]).includes(outputType)) {
    throw new DocumentError(
      `cannot read "${displayPath}": cell ${cellIndex} has an unrecognized output_type "${outputType}"`,
      'NOTEBOOK_PARSE_FAILED',
    )
  }
  let text: string
  if (outputType === 'stream') {
    text = joinSource(raw.text)
  } else if (outputType === 'error') {
    const ename = typeof raw.ename === 'string' ? raw.ename : 'Error'
    const evalue = typeof raw.evalue === 'string' ? raw.evalue : ''
    const tracebackLines = Array.isArray(raw.traceback) ? raw.traceback.map(line => (typeof line === 'string' ? line : '')) : []
    const traceback = stripAnsi(tracebackLines.join('\n'))
    text = traceback.length > 0 ? `${ename}: ${evalue}\n${traceback}` : `${ename}: ${evalue}`
  } else {
    // execute_result / display_data: prefer text/plain; otherwise name the first available mime type.
    const data = isPlainObject(raw.data) ? raw.data : {}
    if ('text/plain' in data) {
      text = joinSource(data['text/plain'])
    } else {
      const mimeTypes = Object.keys(data)
      text = mimeTypes.length > 0 ? `[${mimeTypes[0]} output omitted]` : '[empty output]'
    }
  }
  const bounded = truncateOutput(text, maxChars)
  const type = outputType as NotebookOutputType
  if (bounded.truncated === undefined) return { type, text: bounded.text }
  return { type, text: bounded.text, truncated: bounded.truncated }
}

/**
 * Parse an nbformat-4 notebook's JSON into ordered cells with rendered outputs.
 * @param json - the parsed notebook JSON.
 * @param displayPath - the backend-resolved path, for error messages.
 * @param maxOutputChars - the per-output truncation cap.
 */
export function parseNotebook(json: unknown, displayPath: string, maxOutputChars: number): NotebookReadValue {
  if (!isPlainObject(json) || !Array.isArray(json.cells)) {
    throw new DocumentError(`cannot read "${displayPath}": not an nbformat notebook (missing a "cells" array)`, 'NOTEBOOK_PARSE_FAILED')
  }
  const cells: NotebookCellValue[] = json.cells.map((rawCell, position) => {
    const index = position + 1
    if (!isPlainObject(rawCell) || typeof rawCell.cell_type !== 'string') {
      throw new DocumentError(
        `cannot read "${displayPath}": cell ${index} is malformed (missing "cell_type")`,
        'NOTEBOOK_PARSE_FAILED',
      )
    }
    const cellType = rawCell.cell_type
    if (!(CELL_TYPES as readonly string[]).includes(cellType)) {
      throw new DocumentError(
        `cannot read "${displayPath}": cell ${index} has an unrecognized cell_type "${cellType}"`,
        'NOTEBOOK_PARSE_FAILED',
      )
    }
    const source = joinSource(rawCell.source)
    const rawOutputs = cellType === 'code' && Array.isArray(rawCell.outputs) ? rawCell.outputs : []
    const outputs = rawOutputs.map(rawOutput => renderOutput(rawOutput, index, maxOutputChars, displayPath))
    return { index, cellType: cellType as NotebookCellType, source, outputs }
  })
  return { path: displayPath, cellCount: cells.length, cells }
}

/** Format one `read_notebook` outcome as the model-facing envelope. */
export function formatNotebookReadOutput(value: NotebookReadValue): string {
  const body = value.cells.map((cell) => {
    const header = `--- cell ${cell.index} (${cell.cellType}) ---`
    const outputText = cell.outputs.map(output => `[${output.type}]\n${output.text}`).join('\n')
    return outputText.length > 0 ? `${header}\n${cell.source}\n${outputText}` : `${header}\n${cell.source}`
  }).join('\n\n')
  return `<path>${value.path}</path>
<type>notebook</type>
<content>
cellCount: ${value.cellCount}
${body}
</content>`
}

const NOTEBOOK_OUTPUT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', enum: OUTPUT_TYPES, required: true },
    text: { type: 'string', required: true },
    truncated: { type: 'boolean' },
  },
} as const

const NOTEBOOK_CELL_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    index: { type: 'integer', required: true },
    cellType: { type: 'string', enum: CELL_TYPES, required: true },
    source: { type: 'string', required: true },
    outputs: { type: 'array', required: true, items: NOTEBOOK_OUTPUT_VALUE_SCHEMA },
  },
} as const

/**
 * Register the `read_notebook` tool into the given context.
 * @param ctx - the registration scope; execution uses its `fs` service.
 * @param caps - resolved plugin caps (workspace root, byte cap, output truncation cap).
 */
export function applyReadNotebookTool(ctx: Context, caps: NotebookToolCaps): void {
  ctx.tools.register(defineTool({
    name: 'read_notebook',
    description: 'Read a Jupyter notebook (.ipynb, nbformat 4) and return its cells in order — type, source, and '
      + '(for code cells) outputs. A very large output is truncated with a marker naming how much text was cut.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to the notebook file, resolved by the filesystem backend.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          cellCount: { type: 'integer', required: true },
          cells: { type: 'array', required: true, items: NOTEBOOK_CELL_VALUE_SCHEMA },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatNotebookReadOutput(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const { target, info } = await resolveWorkspaceDocument(ctx, exec, args.file_path, caps.workspaceRoot)
      const data = await ctx.fs.readBytes(target, exec.signal, caps.maxFileBytes)
      let json: unknown
      try {
        json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data))
      } catch (error: unknown) {
        throw new DocumentError(`cannot read "${target.displayPath}": not valid UTF-8 JSON`, 'NOTEBOOK_PARSE_FAILED', { cause: error })
      }
      const value = parseNotebook(json, target.displayPath, caps.maxOutputChars)
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
      return value
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Read notebook ${args.file_path}`,
        kind: 'read',
        locations: [{ path: args.file_path }],
      }
    },
  }))
}
