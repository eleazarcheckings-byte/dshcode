/**
 * Model-facing `read_pdf` and `read_notebook` tools over `ctx.fs` — the two
 * file types Claude Code reads natively that the harness could not open
 * before this package. Both tools confine reads to a configured
 * `workspaceRoot` (see `./workspace.ts`) and never mutate.
 * @module @deepseek-ai/dsh-tool-document
 */

import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import { applyReadNotebookTool } from './notebook.ts'
import { applyReadPdfTool } from './pdf.ts'

export { DocumentError } from './error.ts'
export type { DocumentErrorCode } from './error.ts'
export {
  extractTextFromContentStream,
  formatPdfReadOutput,
  parsePageSelector,
  parsePdfDocument,
  applyReadPdfTool,
} from './pdf.ts'
export type { PdfDocument } from './pdf.ts'
export {
  formatNotebookReadOutput,
  parseNotebook,
  applyReadNotebookTool,
} from './notebook.ts'
export type { NotebookToolCaps } from './notebook.ts'
export { isWithinRoot, resolveWorkspaceDocument } from './workspace.ts'
export type { DocumentToolCaps } from './workspace.ts'
export type {
  NotebookCellType,
  NotebookCellValue,
  NotebookOutputText,
  NotebookOutputType,
  NotebookReadValue,
  PdfPageText,
  PdfReadValue,
} from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-document'

/** Services required by the document tool suite. */
export const inject = ['tools', 'fs']

/** Plugin config (all optional — see the defaults in {@link apply}). */
export interface Config {
  /** Absolute (or cwd-relative) root both tools confine reads to. Defaults to `process.cwd()`. */
  workspaceRoot?: string
  /** Inclusive byte cap on the whole file read into memory for either tool. */
  maxFileBytes?: number
  /** Inclusive character cap on one rendered notebook-cell output before truncation. */
  maxOutputChars?: number
}

/** Default whole-file byte cap: generous for a document a model would plausibly read in one call. */
export const DEFAULT_MAX_FILE_BYTES = 32 * 1024 * 1024

/** Default per-output truncation cap for `read_notebook`. */
export const DEFAULT_MAX_OUTPUT_CHARS = 4000

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-document: ${name} must be a positive integer`)
  }
}

/**
 * Register the `read_pdf` and `read_notebook` tools.
 * @param ctx - the plugin context; registrations are effects scoped to it, and execution uses its `fs` service.
 * @param config - plugin options; every field defaults.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const workspaceRoot = resolve(config.workspaceRoot ?? process.cwd())
  const maxFileBytes = config.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  const maxOutputChars = config.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS
  assertPositiveInteger('maxFileBytes', maxFileBytes)
  assertPositiveInteger('maxOutputChars', maxOutputChars)
  applyReadPdfTool(ctx, { workspaceRoot, maxFileBytes })
  applyReadNotebookTool(ctx, { workspaceRoot, maxFileBytes, maxOutputChars })
}
