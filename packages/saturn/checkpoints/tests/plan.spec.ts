/**
 * The pure half of the checkpoint feature, pinned: path normalization, the
 * shared mutation vocabulary, the turn binding, and the restore plan. Every
 * guarantee that makes a restore safe is decided here — inside the workspace,
 * never through `node_modules` or `.git`, never into the installed app, never
 * outside the recorded set — so this is where they are falsified.
 */
import { describe, expect, it } from 'vitest'
import { sep } from 'node:path'
import {
  guardRefusal,
  isInside,
  mutationPath,
  mutationPathFromArgs,
  normalizeWorkspacePath,
  openTurn,
  planRestore,
  undoPaths,
  type RestoreContext,
} from '../src/plan.ts'
import type { CheckpointRecord } from '../src/types.ts'

const ROOT = process.platform === 'win32' ? 'C:\\work\\proj' : '/work/proj'
const INSTALL = process.platform === 'win32' ? 'C:\\Users\\izzy\\AppData\\Local\\Programs\\@dshcodedesktop' : '/opt/dsh'

/** One recorded blob entry. */
function blob(path: string, hash = 'a'.repeat(64), bytes = 3): CheckpointRecord['entries'][number] {
  return { path, state: { kind: 'blob', hash, bytes } }
}

/** A checkpoint recording exactly the given entries and skips. */
function record(
  entries: readonly CheckpointRecord['entries'][number][],
  skipped: readonly string[] = [],
  workspaceRoot: string | null = ROOT,
): CheckpointRecord {
  return {
    id: '1',
    createdAt: 1_700_000_000_000,
    reason: 'turn',
    turn: 3,
    workspaceRoot,
    entries,
    skipped,
  }
}

const context: RestoreContext = { workspaceRoot: ROOT, installRoot: INSTALL }

describe('normalizeWorkspacePath', () => {
  it('keeps a workspace-relative path inside, spelled in POSIX separators', () => {
    const nested = ['src', 'a.ts'].join(sep)
    const normalized = normalizeWorkspacePath(ROOT, nested)
    expect(normalized).toEqual({ kind: 'inside', rel: 'src/a.ts', absolute: `${ROOT}${sep}src${sep}a.ts` })
  })

  it('takes an absolute path inside the workspace as given', () => {
    const absolute = `${ROOT}${sep}dist${sep}out.js`
    expect(normalizeWorkspacePath(ROOT, absolute)).toEqual({ kind: 'inside', rel: 'dist/out.js', absolute })
  })

  it('refuses the workspace root itself: a checkpoint records files, not the tree', () => {
    expect(normalizeWorkspacePath(ROOT, '.')).toEqual({ kind: 'outside' })
  })

  it('refuses a path that escapes the workspace', () => {
    expect(normalizeWorkspacePath(ROOT, '../secrets.txt')).toEqual({ kind: 'outside' })
    expect(normalizeWorkspacePath(ROOT, `${ROOT}${sep}..${sep}secrets.txt`)).toEqual({ kind: 'outside' })
  })

  it('resolves a .. that stays inside rather than refusing it', () => {
    const normalized = normalizeWorkspacePath(ROOT, ['src', '..', 'a.ts'].join(sep))
    expect(normalized).toEqual({ kind: 'inside', rel: 'a.ts', absolute: `${ROOT}${sep}a.ts` })
  })
})

describe('isInside', () => {
  it('holds for the root itself and everything under it', () => {
    expect(isInside(ROOT, ROOT)).toBe(true)
    expect(isInside(ROOT, `${ROOT}${sep}nested${sep}file`)).toBe(true)
  })

  it('is false for a sibling that merely shares a prefix', () => {
    expect(isInside(ROOT, `${ROOT}-other`)).toBe(false)
    expect(isInside(`${ROOT}${sep}nested`, ROOT)).toBe(false)
  })
})

describe('guardRefusal', () => {
  it('passes ordinary workspace content', () => {
    expect(guardRefusal(`${ROOT}${sep}src${sep}main.ts`, INSTALL)).toBeNull()
  })

  it('refuses any path running through node_modules, at any depth', () => {
    expect(guardRefusal(`${ROOT}${sep}node_modules${sep}pkg${sep}index.js`, INSTALL)).toContain('node_modules')
    expect(guardRefusal(`${ROOT}${sep}src${sep}node_modules${sep}x`, INSTALL)).toContain('node_modules')
    // The guard is case-insensitive and quotes the spelling it found.
    expect(guardRefusal(`${ROOT}${sep}NODE_MODULES${sep}x`, INSTALL)?.toLowerCase()).toContain('node_modules')
  })

  it('refuses repository internals', () => {
    expect(guardRefusal(`${ROOT}${sep}.git${sep}config`, INSTALL)).toContain('.git')
  })

  it('refuses the installed app tree, and only when it is known', () => {
    expect(guardRefusal(`${INSTALL}${sep}resources${sep}app${sep}x.js`, INSTALL)).toContain('installed app')
    expect(guardRefusal(`${INSTALL}${sep}resources${sep}app${sep}x.js`, null)).toBeNull()
  })
})

describe('the mutation vocabulary', () => {
  it('names the target of a complete write', () => {
    expect(mutationPath('write', JSON.stringify({ file_path: 'a.ts', content: 'x' }))).toBe('a.ts')
  })

  it('ignores a write with no content: nothing is being replaced', () => {
    expect(mutationPath('write', JSON.stringify({ file_path: 'a.ts', content: 42 }))).toBeNull()
  })

  it('names the target of a real edit', () => {
    const args = { file_path: 'a.ts', old_string: 'one', new_string: 'two' }
    expect(mutationPath('edit', JSON.stringify(args))).toBe('a.ts')
  })

  it('ignores an edit that replaces nothing, or replaces a string with itself', () => {
    expect(mutationPath('edit', JSON.stringify({ file_path: 'a.ts', old_string: '', new_string: 'x' }))).toBeNull()
    expect(mutationPath('edit', JSON.stringify({ file_path: 'a.ts', old_string: 'a', new_string: 'a' }))).toBeNull()
    expect(mutationPath('edit', JSON.stringify({ file_path: 'a.ts', old_string: 'a' }))).toBeNull()
    expect(mutationPath('edit', JSON.stringify({ file_path: 'a.ts', old_string: 'a', new_string: 'b', replace_all: 'yes' }))).toBeNull()
  })

  it('names the target of each mutating editor command', () => {
    const path = 'a.ts'
    expect(mutationPath('str_replace_editor', JSON.stringify({ command: 'create', path, file_text: 'x' }))).toBe(path)
    expect(mutationPath('str_replace_editor', JSON.stringify({ command: 'str_replace', path, old_str: 'a', new_str: 'b' }))).toBe(path)
    expect(mutationPath('str_replace_editor', JSON.stringify({ command: 'insert', path, insert_line: 0, new_str: 'x' }))).toBe(path)
  })

  it('ignores an editor command that reads rather than writes', () => {
    expect(mutationPath('str_replace_editor', JSON.stringify({ command: 'view', path: 'a.ts' }))).toBeNull()
    expect(mutationPath('str_replace_editor', JSON.stringify({ command: 'create', path: 'a.ts' }))).toBeNull()
    expect(mutationPath('str_replace_editor', JSON.stringify({ command: 'insert', path: 'a.ts', insert_line: -1, new_str: 'x' }))).toBeNull()
    expect(mutationPath('str_replace_editor', JSON.stringify({ command: 'str_replace', path: 'a.ts', old_str: '' }))).toBeNull()
  })

  it('ignores tools outside the vocabulary, whatever they name', () => {
    expect(mutationPath('terminal_send', JSON.stringify({ file_path: 'a.ts', content: 'x' }))).toBeNull()
    expect(mutationPath('read', JSON.stringify({ file_path: 'a.ts' }))).toBeNull()
  })

  it('never throws on arguments that are not an object, or not JSON at all', () => {
    expect(mutationPath('write', 'not json')).toBeNull()
    expect(mutationPath('write', '[1,2]')).toBeNull()
    expect(mutationPath('write', 'null')).toBeNull()
    expect(mutationPathFromArgs('write', undefined)).toBeNull()
  })

  it('rejects a blank path spelling', () => {
    expect(mutationPath('write', JSON.stringify({ file_path: '   ', content: 'x' }))).toBeNull()
  })
})

describe('openTurn', () => {
  it('finds the turn the newest boundary opened', () => {
    expect(openTurn([{ type: 'turn/start', data: { turn: 0 } }])).toBe(0)
    expect(openTurn([
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'turn/end', data: { turn: 1 } },
      { type: 'turn/start', data: { turn: 2 } },
    ])).toBe(2)
  })

  it('reports no open turn once the newest boundary is an end', () => {
    expect(openTurn([
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'turn/end', data: { turn: 1 } },
    ])).toBeNull()
  })

  it('ignores unrelated events and logs with no boundary at all', () => {
    expect(openTurn([])).toBeNull()
    expect(openTurn([{ type: 'user/message' }, { type: 'tool/result' }])).toBeNull()
    expect(openTurn([
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'tool/result' },
    ])).toBe(1)
  })

  it('refuses a boundary that names no usable turn number', () => {
    expect(openTurn([{ type: 'turn/start' }])).toBeNull()
    expect(openTurn([{ type: 'turn/start', data: { turn: 'one' } }])).toBeNull()
    expect(openTurn([{ type: 'turn/start', data: { turn: -1 } }])).toBeNull()
    expect(openTurn([{ type: 'turn/start', data: { turn: 1.5 } }])).toBeNull()
  })
})

describe('planRestore', () => {
  it('plans the writes and the removes a record implies', () => {
    const plan = planRestore(context, record([blob('src/a.ts', 'b'.repeat(64), 5), { path: 'new.ts', state: { kind: 'absent' } }]))
    expect(plan.ok).toBe(true)
    expect(plan.refusals).toEqual([])
    expect(plan.writes).toEqual([{
      path: 'src/a.ts',
      absolute: `${ROOT}${sep}src${sep}a.ts`,
      hash: 'b'.repeat(64),
      bytes: 5,
    }])
    expect(plan.removes).toEqual([{ path: 'new.ts', absolute: `${ROOT}${sep}new.ts` }])
    expect(plan.leftAlone).toEqual([])
  })

  it('reports a skipped path as left alone instead of pretending it was recorded', () => {
    const plan = planRestore(context, record([blob('a.ts')], ['huge.bin']))
    expect(plan.ok).toBe(true)
    expect(plan.leftAlone).toEqual([{ path: 'huge.bin', why: 'not-captured' }])
    expect(plan.writes.map(write => write.path)).toEqual(['a.ts'])
  })

  it('records each path once, whatever the record repeats', () => {
    const plan = planRestore(context, record([blob('a.ts'), blob('a.ts', 'c'.repeat(64), 9)]))
    expect(plan.ok).toBe(true)
    expect(plan.writes).toHaveLength(1)
    expect(plan.writes[0]?.hash).toBe('a'.repeat(64))
  })

  it('refuses wholesale when the session has no workspace', () => {
    const plan = planRestore({ workspaceRoot: null, installRoot: INSTALL }, record([blob('a.ts')]))
    expect(plan.ok).toBe(false)
    expect(plan.refusals).toEqual(['this session has no workspace to restore into'])
    expect(plan.writes).toEqual([])
  })

  it('refuses a checkpoint recorded in a different workspace', () => {
    const other = process.platform === 'win32' ? 'C:\\work\\other' : '/work/other'
    const plan = planRestore(context, record([blob('a.ts')], [], other))
    expect(plan.ok).toBe(false)
    expect(plan.refusals.some(line => line.includes('not the session\'s'))).toBe(true)
    expect(plan.writes).toEqual([])
  })

  it('refuses when the workspace IS the installed app', () => {
    const inside: RestoreContext = { workspaceRoot: `${INSTALL}${sep}resources`, installRoot: INSTALL }
    const plan = planRestore(inside, record([blob('a.ts')], [], `${INSTALL}${sep}resources`))
    expect(plan.ok).toBe(false)
    expect(plan.refusals).toContain('this workspace is the installed app itself, which a restore never writes into')
  })

  it('refuses a recorded path that has become a guarded location', () => {
    const plan = planRestore(context, record([blob('node_modules/pkg/index.js'), blob('ok.ts')]))
    expect(plan.ok).toBe(false)
    expect(plan.refusals.some(line => line.includes('node_modules'))).toBe(true)
    // One refusal fails the whole plan: the safe path is not applied partially.
    expect(plan.writes).toEqual([])
  })

  it('refuses a recorded path that resolves outside the workspace', () => {
    const plan = planRestore(context, record([blob('../escape.ts')]))
    expect(plan.ok).toBe(false)
    expect(plan.refusals.some(line => line.includes('outside the workspace'))).toBe(true)
  })
})

describe('undoPaths', () => {
  it('names exactly the paths a restore will touch', () => {
    const plan = planRestore(context, record([blob('src/a.ts'), { path: 'new.ts', state: { kind: 'absent' } }]))
    expect(undoPaths(plan)).toEqual(['src/a.ts', 'new.ts'])
  })

  it('is empty when the plan was refused, so an undo capture records nothing', () => {
    const plan = planRestore({ workspaceRoot: null, installRoot: null }, record([blob('a.ts')]))
    expect(undoPaths(plan)).toEqual([])
  })
})
