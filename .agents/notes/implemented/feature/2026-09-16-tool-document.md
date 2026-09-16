# Agent Note: read_pdf and read_notebook — the file types Claude Code reads natively

Status: implemented

English | [中文](2026-09-16-tool-document.zh.md)

## Problem

Claude Code reads PDF and Jupyter notebook files natively; this harness had no equivalent — a model asked to inspect a PDF or `.ipynb` file had no tool that could open either format, only the UTF-8-only `read` tool from `dsh-tool-fs`.

## Decision

New package `packages/fs/tool-document` (`@deepseek-ai/dsh-tool-document`), following `dsh-tool-fs`'s read-tool shape (`resolveRegularReadTarget`-style path resolution, `ctx.fs.readBytes` byte caps, `fs/observed` emission) but standalone: it injects only `['tools', 'fs']`, with no attachment store, sandbox, or session dependency, and enforces its own `workspaceRoot` confinement (`src/workspace.ts`) because `ctx.fs` backends resolve paths without all confining them.

`read_notebook` parses nbformat 4 JSON directly — cells in order, joined source, and rendered outputs (`stream`/`execute_result`/`display_data`/`error`, preferring `text/plain`, ANSI-stripped tracebacks), with a `maxOutputChars` cap that appends a truncation marker naming exactly how much text was cut.

`read_pdf` needed a text extractor and none is vendored in this workspace (checked: no `pdfjs*`/`pdf-parse*`/`unpdf*` under `node_modules`). Per the mandate's fallback, it implements a minimal in-tree extractor rather than leaving the tool unimplemented: objects are found by scanning `N 0 obj … endobj` (no xref parsing), the page tree is walked from `/Catalog` through `/Pages`/`/Kids`, and each page's content stream — `FlateDecode` (via `node:zlib`) or uncompressed — is scanned for `Tj`/`TJ` text-showing operators, with `Td`/`TD`/`T*` as line breaks. A `pages` selector (`"2"`, `"2-4"`, `"1,3-5"`) narrows the read; an out-of-range or malformed selector fails loud with a named `DocumentError` code (`PDF_PAGE_RANGE_OUT_OF_RANGE` / `PDF_PAGE_RANGE_INVALID`) rather than silently clamping.

## Alternatives considered

**Add a PDF library dependency (`pdfjs-dist`, `pdf-parse`, `unpdf`).** Rejected for this cell: the mandate forbids installing new dependencies (`pnpm install` is not this cell's to run), and no such library was already present in `node_modules`. The in-tree extractor is deliberately narrow rather than reimplementing a general PDF renderer — swapping in a real library later is a self-contained follow-up once one is vendored (flagged under `integration_needs`).

**Confine paths by trusting the mounted `ctx.fs` backend alone.** Rejected: `LocalFileSystem.resolve` is documented as "a resolution default, NOT a containment boundary" — it realpaths but does not refuse a path that escapes its configured `cwd`. `src/workspace.ts`'s `resolveWorkspaceDocument` adds the explicit `workspaceRoot` containment check both tools share, refusing with `DOCUMENT_PATH_OUTSIDE_WORKSPACE` before any read.

**Parse the PDF cross-reference table properly.** Rejected for this minimal extractor: a stale or absent xref (common after a naive edit, and irrelevant to a scanning approach) would otherwise block extraction entirely; scanning for `N 0 obj … endobj` directly is what real viewers' fallback recovery path does anyway, and is sufficient for the single-revision, non-encrypted PDFs this tool targets.

## Consequences

`ctx.tools` gains `read_pdf` and `read_notebook` once this package is composed after a `ctx.fs` backend; no other capability seam is required. The PDF extractor's known gaps (no cross-reference/object-stream/encryption support, no `ToUnicode` CMap, scanned/image-only PDFs return empty text, `TJ` kerning numbers never become a space) are documented in the package README's Known Limitations rather than silently mishandled. `docs/tool-catalog.md` needs a `doc-sync` regeneration to pick up the two new tool schemas, and the root `tsconfig.host.json`/`tsconfig.client.json` project reference plus any bundle/preset row are integration items this cell does not add itself (tracked under `integration_needs`).
