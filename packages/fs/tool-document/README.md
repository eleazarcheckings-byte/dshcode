---
description: "The model-facing read_pdf and read_notebook tools for users and maintainers composing or debugging document access for agents."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-document

English | [中文](README.zh.md)

## Summary

`dsh-tool-document` provides `read_pdf` and `read_notebook` — the two file types Claude Code reads natively that the harness could not open before this package. `read_pdf` extracts page-ranged text plus the total page count from a PDF; `read_notebook` returns a Jupyter (nbformat 4) notebook's cells in order with source and rendered outputs, truncating any huge output with a marker. Both tools confine reads to a configured workspace root and never mutate. Choose this package when the model needs to inspect a PDF or notebook file directly; every other file type stays the sibling `dsh-tool-fs` package's `read` tool.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin after a `ctx.fs` backend and a `ctx.tools` runtime. No attachment store, sandbox, or session service is required — both tools resolve paths through `ctx.fs` and confine them to the configured `workspaceRoot` themselves.

### Minimal composition

```yaml
- name: '@deepseek-ai/dsh-fs-local'
  config:
    cwd: /path/to/workspace
- name: '@deepseek-ai/dsh-tool-document'
  config:
    workspaceRoot: /path/to/workspace
```

### The tools

| Tool | Arguments | Behavior |
|---|---|---|
| `read_pdf` | `file_path`, `pages?` | Extracts text for the selected pages (a page number, a `start-end` range, or a comma-separated mix; omit for every page) plus the document's total page count |
| `read_notebook` | `file_path` | Returns every cell in order — type, joined source, and (for code cells) rendered outputs — with a huge output truncated and marked |

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `workspaceRoot` | `process.cwd()` | Root both tools confine reads to; a resolved path outside it refuses with `DOCUMENT_PATH_OUTSIDE_WORKSPACE` |
| `maxFileBytes` | `33554432` (32 MiB) | Inclusive byte cap on the whole file read into memory for either tool |
| `maxOutputChars` | `4000` | Inclusive character cap on one rendered notebook-cell output before truncation |

### PDF support

`read_pdf` implements a minimal in-tree extractor — no maintained PDF library (`pdfjs`/`pdf-parse`/`unpdf`) is vendored in this workspace. It supports single-revision, text-only PDFs whose page text lives in `Tj`/`TJ` content-stream operators, either uncompressed or `FlateDecode`-compressed. It does not parse the cross-reference table (objects are found by scanning `N 0 obj … endobj`, which tolerates a stale or absent xref), and does not resolve encryption, object streams, cross-reference streams, or `ToUnicode` CMaps — see [Known Limitations](#known-limitations-and-deferred-work).

### Failures and recovery

Failures carry the package-owned `DocumentError` codes: `DOCUMENT_EMPTY_PATH`, `DOCUMENT_NOT_FOUND`, `DOCUMENT_NOT_REGULAR_FILE`, `DOCUMENT_PATH_OUTSIDE_WORKSPACE` (both tools); `PDF_PARSE_FAILED`, `PDF_UNSUPPORTED_FILTER`, `PDF_PAGE_RANGE_INVALID`, `PDF_PAGE_RANGE_OUT_OF_RANGE` (`read_pdf`); `NOTEBOOK_PARSE_FAILED` (`read_notebook`, covering both malformed JSON and a notebook that does not match the nbformat cell/output shape this package understands).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the two tools and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

Both tools are read-only, confined to a `workspaceRoot`, and independent of every other capability seam — no attachment store (unlike `read_image`), no sandbox controller, no session cwd requirement. `ctx.fs` backends resolve paths but do not all confine them (the bare local backend is a resolution default, not a containment boundary), so `src/workspace.ts` enforces containment against the configured root explicitly, before any byte is read.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config`, defaults, cap validation, tool composition |
| [`src/workspace.ts`](src/workspace.ts) | Shared path resolution, workspace confinement, regular-file validation |
| [`src/pdf.ts`](src/pdf.ts) | `read_pdf`: the in-tree PDF object scanner, page-tree walk, content-stream text extractor, page-selector parser |
| [`src/notebook.ts`](src/notebook.ts) | `read_notebook`: nbformat cell/output parsing, ANSI stripping, output truncation |
| [`src/error.ts`](src/error.ts) | `DocumentError` — a stable `code` beside the model-facing message |
| [`src/types.ts`](src/types.ts) | Output value types (types-only) |

### The PDF extractor's supported subset

Objects are found by scanning the whole file for `N 0 obj … endobj` rather than parsing the cross-reference table, so a stale or absent xref (common after a naive edit) does not block extraction. The page tree is walked depth-first from the `/Catalog`'s `/Pages` root through `/Kids`, collecting leaf `/Page` objects; each page's `/Contents` stream(s) are decoded (`FlateDecode` via `node:zlib`, or passed through unfiltered) and scanned for `Tj`/`TJ` text-showing operators, with `Td`/`TD`/`T*` treated as line breaks and `BT`/`ET` bracketing one text object. Every other operator — font, color, graphics state, positioning — is inert.

### Notebook output rendering

`execute_result`/`display_data` outputs prefer `text/plain`; without it, the first other mime type is named rather than shown (`[image/png output omitted]`). `error` outputs join `ename: evalue` with the traceback, stripped of ANSI SGR escapes. `stream` outputs join their `text` field verbatim. Every rendered output is capped at `maxOutputChars`, with a marker naming exactly how many characters were cut — never a silent truncation.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Tool schemas

#### What the model sees

The generated schemas for `read_pdf` and `read_notebook` in the [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-document) name the `pages` selector syntax and the truncation behavior; both tools are registered unconditionally once the plugin is mounted.

#### Token effect

Fixed schema cost on every request where the tools are visible.

#### KV Cache effect

Prefix-stable while tool visibility and definitions are unchanged. Registration lifecycle or scoped restrictions may invalidate reuse from the first changed schema token.

### Results and errors

#### What the model sees

`read_pdf` returns `<path>`/`<type>pdf</type>`/`<content>` with `totalPages` and each selected page under a `--- page N ---` heading. `read_notebook` returns the same envelope shape with `<type>notebook</type>`, `cellCount`, and each cell under a `--- cell N (type) ---` heading, its outputs bracketed by `[output_type]`. A truncated output ends with `... [truncated N more characters]`. Failures are normalized as `Error: <message>` with a stable `DocumentError` code (`DOCUMENT_*`, `PDF_*`, or `NOTEBOOK_PARSE_FAILED`) for callers that branch on failure kind.

#### Token effect

Bounded by `maxFileBytes` (the whole file, before extraction) and `maxOutputChars` (each notebook output); the call and retained result stay in history until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No maintained PDF library is vendored** — `read_pdf` runs a minimal in-tree extractor instead of `pdfjs`/`pdf-parse`/`unpdf`. It does not parse the cross-reference table, and does not resolve encryption, object streams, cross-reference streams, or `ToUnicode` CMaps; text in a non-Latin-1-compatible simple font, or in a scanned/image-only PDF, returns empty page text rather than an error. Swapping in a real extractor library, once one is vendored in this workspace, is a self-contained follow-up inside this package.
- **`TJ` kerning numbers never become a space** — a `TJ` array's numeric operands (inter-glyph positioning) are dropped rather than converted to whitespace, so two adjacent strings in one `TJ` array with no explicit space character run together in the extracted text.
- **`read_notebook` requires a strict nbformat 4 cell/output shape** — an unrecognized `cell_type`/`output_type`, or a missing required field, fails the whole read as `NOTEBOOK_PARSE_FAILED` rather than skipping the offending cell; older nbformat versions and vendor-specific output types outside the four nbformat 4 kinds are unsupported.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This model-facing tool pair has no independent lifecycle stream; it registers into the mounted `ctx.tools` runtime and holds no state of its own.
