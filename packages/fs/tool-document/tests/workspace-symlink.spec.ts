/**
 * Workspace-confinement must hold against a symlinked ancestor inside the
 * workspace root that points outside it — not only against a lexical `..`
 * escape or an absolute path (already covered in `pdf.spec.ts`/
 * `notebook.spec.ts`). `LocalFileSystem.resolve` sets `displayPath` to the
 * as-spelled resolved path with no symlink resolution, while the bytes are
 * read from `targetKey`, the realpath; checking containment on `displayPath`
 * lets a symlinked/junctioned directory inside the root smuggle a read of a
 * file outside it. See `fs-sandbox`'s `containment.spec.ts` for the same
 * class of test against that package's own fence.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as ToolDocument from '../src/index.ts'

const PDF_FIXTURE = join(import.meta.dirname, 'fixtures', 'sample.pdf')
const NOTEBOOK_FIXTURE = join(import.meta.dirname, 'fixtures', 'sample.ipynb')
const testSignal = new AbortController().signal

let base: string

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'dsh-tool-document-symlink-'))
})
afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

async function setup(workspaceRoot: string) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin(LocalFileSystem, { cwd: workspaceRoot })
  await ctx.plugin(ToolDocument, { workspaceRoot })
  return ctx
}

let callCounter = 0
function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: testSignal,
    callId: ToolCallId(`symlink-call-${++callCounter}`),
    name,
    arguments: args,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

/**
 * Build `<base>/workspace` containing a directory symlink `out` that points
 * at `<base>/outside`, and drop the given fixture at `<base>/outside/<name>`.
 * @returns the workspace root to configure the plugin with.
 */
async function buildEscapeLayout(fixture: string, name: string): Promise<string> {
  const workspace = join(base, 'workspace')
  const outside = join(base, 'outside')
  await mkdir(workspace)
  await mkdir(outside)
  await writeFile(join(outside, name), await readFile(fixture))
  await symlink(outside, join(workspace, 'out'), 'junction')
  return workspace
}

describe('workspace confinement against a symlinked/junctioned escape', () => {
  it('refuses read_pdf through a directory symlink inside the root pointing outside it', async () => {
    const workspace = await buildEscapeLayout(PDF_FIXTURE, 'secret.pdf')
    const ctx = await setup(workspace)
    const result = await call(ctx, 'read_pdf', { file_path: join('out', 'secret.pdf') })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('path is outside the workspace root')
  })

  it('refuses read_notebook through a directory symlink inside the root pointing outside it', async () => {
    const workspace = await buildEscapeLayout(NOTEBOOK_FIXTURE, 'secret.ipynb')
    const ctx = await setup(workspace)
    const result = await call(ctx, 'read_notebook', { file_path: join('out', 'secret.ipynb') })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('path is outside the workspace root')
  })
})
