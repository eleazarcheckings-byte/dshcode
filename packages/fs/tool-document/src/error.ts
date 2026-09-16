/**
 * Typed error taxonomy for the document tool suite, mirroring `FsError`'s
 * shape (a stable `code` beside the model-facing `message`) so callers can
 * branch on failure kind without parsing prose.
 * @module @deepseek-ai/dsh-tool-document/error
 */

/** Stable failure codes surfaced by `read_pdf` and `read_notebook`. */
export type DocumentErrorCode =
  | 'DOCUMENT_EMPTY_PATH'
  | 'DOCUMENT_NOT_FOUND'
  | 'DOCUMENT_NOT_REGULAR_FILE'
  | 'DOCUMENT_PATH_OUTSIDE_WORKSPACE'
  | 'PDF_PARSE_FAILED'
  | 'PDF_UNSUPPORTED_FILTER'
  | 'PDF_PAGE_RANGE_INVALID'
  | 'PDF_PAGE_RANGE_OUT_OF_RANGE'
  | 'NOTEBOOK_PARSE_FAILED'

/** A document-tool failure carrying a stable `code` beside its model-facing message. */
export class DocumentError extends Error {
  readonly code: DocumentErrorCode

  constructor(message: string, code: DocumentErrorCode, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DocumentError'
    this.code = code
  }
}
