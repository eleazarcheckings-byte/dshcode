/**
 * Types-only module for `@deepseek-ai/dsh-tool-document` — no runtime code.
 * @module @deepseek-ai/dsh-tool-document/types
 */

/** One page's extracted text, as returned by `read_pdf`. */
export interface PdfPageText {
  /** 1-based page number within the document. */
  page: number
  /** Extracted text for this page; content-stream text-showing operators only. */
  text: string
}

/** The structured outcome declared by the `read_pdf` output schema. */
export interface PdfReadValue {
  path: string
  /** Total number of pages in the document, regardless of how many were selected. */
  totalPages: number
  /** Extracted text for the selected pages, in ascending page order. */
  pages: PdfPageText[]
  /**
   * Present (and `true`) only when the assembled text across selected pages
   * was cut short at `maxTextChars`, dropping any page after the cut; matches
   * the `boolean` output-schema field (the schema DSL has no literal-`true` type).
   */
  truncated?: boolean
}

/** nbformat cell types this package understands. */
export type NotebookCellType = 'code' | 'markdown' | 'raw'

/** nbformat output types this package understands. */
export type NotebookOutputType = 'stream' | 'execute_result' | 'display_data' | 'error'

/** One rendered notebook cell output, as returned by `read_notebook`. */
export interface NotebookOutputText {
  type: NotebookOutputType
  /** The output's text — stream text, the `text/plain` repr, or `ename: evalue` plus traceback. */
  text: string
  /**
   * Present (and `true`) only when `text` was cut short of the source output;
   * matches the `boolean` output-schema field (the schema DSL has no literal-`true` type).
   */
  truncated?: boolean
}

/** One rendered notebook cell, as returned by `read_notebook`. */
export interface NotebookCellValue {
  /** 1-based position of this cell within the notebook. */
  index: number
  cellType: NotebookCellType
  /** The cell's joined source text. */
  source: string
  /** Rendered outputs, in original order; empty for non-code cells. */
  outputs: NotebookOutputText[]
}

/** The structured outcome declared by the `read_notebook` output schema. */
export interface NotebookReadValue {
  path: string
  /** Total number of cells in the notebook. */
  cellCount: number
  cells: NotebookCellValue[]
}
