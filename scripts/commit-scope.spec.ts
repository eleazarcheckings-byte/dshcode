import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  evaluateCommitScope,
  isCommentOnlyDiff,
  isLogicPath,
  parseCommitHeader,
  scopeException,
} from './commit-scope.ts'
import { removeFixtureSafely } from './test-fixture-cleanup.ts'

const verifier = fileURLToPath(new URL('./verify-commit-scope.ts', import.meta.url))
const tsxCli = join(dirname(fileURLToPath(import.meta.resolve('tsx/package.json'))), 'dist', 'cli.mjs')
const fixtures: string[] = []

const JSDOC_ONLY_DIFF = [
  'diff --git a/packages/x/y/src/index.ts b/packages/x/y/src/index.ts',
  'index c8249ee326..05595a4a66 100644',
  '--- a/packages/x/y/src/index.ts',
  '+++ b/packages/x/y/src/index.ts',
  '@@ -231 +231,5 @@ export class Service {',
  '-  /** Whether the deployment has opted in. */',
  '+  /**',
  '+   * Whether the deployment has opted in.',
  '+   * @returns the current config flag.',
  '+   */',
  '+',
  '',
].join('\n')

const LOGIC_DIFF = [
  'diff --git a/packages/x/y/src/index.ts b/packages/x/y/src/index.ts',
  'index c8249ee326..05595a4a66 100644',
  '--- a/packages/x/y/src/index.ts',
  '+++ b/packages/x/y/src/index.ts',
  '@@ -10 +10,2 @@ export function apply() {',
  '-  return value',
  '+  // explain the guard',
  '+  return value ?? fallback',
  '',
].join('\n')

afterEach(() => {
  for (const fixture of fixtures.splice(0)) removeFixtureSafely(fixture)
})

describe('parseCommitHeader', () => {
  it('reads the conventional type and scope', () => {
    expect(parseCommitHeader('docs(saturn): re-record sidecars\n\nbody')).toEqual({ type: 'docs', scope: 'saturn', subject: 're-record sidecars' })
    expect(parseCommitHeader('feat!: breaking change')).toEqual({ type: 'feat', scope: undefined, subject: 'breaking change' })
    expect(parseCommitHeader('chore: tidy')).toEqual({ type: 'chore', scope: undefined, subject: 'tidy' })
  })

  it('leaves merges, reverts, and free-form subjects untyped', () => {
    expect(parseCommitHeader("Merge branch 'x' into master").type).toBeUndefined()
    expect(parseCommitHeader('Revert "feat(x): y"').type).toBeUndefined()
    expect(parseCommitHeader('land in-flight work').type).toBeUndefined()
    expect(parseCommitHeader('').type).toBeUndefined()
  })
})

describe('scopeException', () => {
  it('reads a Scope-Exception trailer anywhere in the body', () => {
    expect(scopeException('docs(x): y\n\nScope-Exception: JSDoc needs a type import\n')).toBe('JSDoc needs a type import')
    expect(scopeException('docs(x): y\n\nCo-Authored-By: someone\n')).toBeUndefined()
  })

  it('ignores an empty trailer', () => {
    expect(scopeException('docs(x): y\n\nScope-Exception:   \n')).toBeUndefined()
  })
})

describe('isLogicPath', () => {
  it('matches source and test code under src/ and tests/', () => {
    expect(isLogicPath('packages/saturn/tool-media/src/index.ts')).toBe(true)
    expect(isLogicPath('packages/saturn/tool-media/tests/tool-media.spec.ts')).toBe(true)
    expect(isLogicPath('apps/desktop/src/main.ts')).toBe(true)
    expect(isLogicPath('packages/client/ui-x/src/client/Panel.tsx')).toBe(true)
    expect(isLogicPath('apps/web/src/boot.mjs')).toBe(true)
  })

  it('leaves docs, records, notes, and non-code assets alone', () => {
    expect(isLogicPath('packages/saturn/tool-media/README.md')).toBe(false)
    expect(isLogicPath('packages/saturn/tool-media/README.i18n.yaml')).toBe(false)
    expect(isLogicPath('.agents/notes/implemented/feature/2026-09-15-x.md')).toBe(false)
    expect(isLogicPath('packages/client/ui-x/src/client/Panel.module.css')).toBe(false)
    expect(isLogicPath('docs/tool-catalog.md')).toBe(false)
    expect(isLogicPath('scripts/verify-commit-scope.ts')).toBe(false)
    expect(isLogicPath('packages/x/y/package.json')).toBe(false)
  })
})

describe('isCommentOnlyDiff', () => {
  it('accepts a diff whose changed lines are only comments and blanks', () => {
    expect(isCommentOnlyDiff(JSDOC_ONLY_DIFF)).toBe(true)
  })

  it('rejects a diff that touches a code line, even beside a new comment', () => {
    expect(isCommentOnlyDiff(LOGIC_DIFF)).toBe(false)
  })

  it('treats an empty diff as comment-only', () => {
    expect(isCommentOnlyDiff('')).toBe(true)
  })
})

describe('evaluateCommitScope', () => {
  const diffs: Record<string, string> = {
    'packages/x/y/src/index.ts': LOGIC_DIFF,
    'packages/x/y/src/service.ts': JSDOC_ONLY_DIFF,
  }
  const diffFor = (path: string): string => diffs[path] ?? ''

  it('lets a docs() commit carry JSDoc-only edits to source', () => {
    const verdict = evaluateCommitScope({ message: 'docs(x): JSDoc completeness', paths: ['packages/x/y/src/service.ts', 'packages/x/y/README.md'], diffFor })
    expect(verdict).toMatchObject({ ok: true, type: 'docs', violations: [], exception: undefined })
  })

  it('refuses a docs() commit that changes logic', () => {
    const verdict = evaluateCommitScope({ message: 'docs(x): re-record sidecars', paths: ['packages/x/y/src/index.ts'], diffFor })
    expect(verdict.ok).toBe(false)
    expect(verdict.violations).toHaveLength(1)
    expect(verdict.violations[0]).toContain('packages/x/y/src/index.ts')
    expect(verdict.violations[0]).toContain('docs')
  })

  it('refuses a chore() commit that carries any source or test code', () => {
    const verdict = evaluateCommitScope({ message: 'chore(saturn): land in-flight work', paths: ['packages/x/y/src/service.ts', 'packages/x/y/package.json'], diffFor })
    expect(verdict.ok).toBe(false)
    expect(verdict.violations).toHaveLength(1)
    expect(verdict.violations[0]).toContain('packages/x/y/src/service.ts')
  })

  it('lets a chore() commit touch manifests, configs, and generated docs', () => {
    const verdict = evaluateCommitScope({ message: 'chore(desktop): 1.2.5', paths: ['apps/desktop/package.json', 'docs/tool-catalog.md', 'THIRD_PARTY_NOTICES.md'], diffFor })
    expect(verdict).toMatchObject({ ok: true, violations: [] })
  })

  it('does not judge feature, fix, test, build, or untyped commits', () => {
    for (const message of ['feat(x): y', 'fix(x): y', 'test(x): RED', 'build(x): y', "Merge branch 'a'"]) {
      expect(evaluateCommitScope({ message, paths: ['packages/x/y/src/index.ts'], diffFor }).ok).toBe(true)
    }
  })

  it('waives the violations, and says so, when the message carries a Scope-Exception trailer', () => {
    const verdict = evaluateCommitScope({ message: 'docs(x): y\n\nScope-Exception: the JSDoc needed a type-only import\n', paths: ['packages/x/y/src/index.ts'], diffFor })
    expect(verdict.ok).toBe(true)
    expect(verdict.exception).toBe('the JSDoc needed a type-only import')
    expect(verdict.violations).toHaveLength(1)
  })
})

describe('verify-commit-scope CLI', () => {
  function repo(): string {
    const root = mkdtempSync(join(tmpdir(), 'dsh-commit-scope-'))
    fixtures.push(root)
    const git = (...args: string[]): void => {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
      if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
    }
    git('init', '-q')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Commit Scope Test')
    git('config', 'commit.gpgsign', 'false')
    mkdirSync(join(root, 'packages', 'x', 'y', 'src'), { recursive: true })
    writeFileSync(join(root, 'packages', 'x', 'y', 'src', 'index.ts'), 'export const value = 1\n')
    writeFileSync(join(root, 'packages', 'x', 'y', 'README.md'), '# y\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'feat(y): seed')
    writeFileSync(join(root, 'packages', 'x', 'y', 'src', 'index.ts'), 'export const value = 2\n')
    git('add', '-A')
    return root
  }

  function run(root: string, message: string): { status: number | null; stdout: string; stderr: string } {
    const messagePath = join(root, 'COMMIT_EDITMSG')
    writeFileSync(messagePath, message)
    const result = spawnSync(process.execPath, [tsxCli, verifier, messagePath], { cwd: root, encoding: 'utf8' })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
  }

  it('fails a chore() commit whose staged files carry source code, naming the path', () => {
    const result = run(repo(), 'chore(y): land in-flight work\n')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('packages/x/y/src/index.ts')
    expect(result.stderr).toContain('Scope-Exception')
  })

  it('passes a feat() commit over the same staged files', () => {
    const result = run(repo(), 'feat(y): bump the value\n')
    expect(result.status).toBe(0)
  })

  it('passes a waived docs() commit and prints the waiver', () => {
    const result = run(repo(), 'docs(y): explain the value\n\nScope-Exception: reviewed with the maintainer\n')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('reviewed with the maintainer')
  })

  it('rejects a missing message path with usage', () => {
    const result = spawnSync(process.execPath, [tsxCli, verifier], { cwd: repo(), encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('usage')
  })
})
