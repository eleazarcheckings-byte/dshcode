/**
 * Git-hook half of the commit-type scope gate (lefthook `commit-msg`): reads
 * the message file git passes, the staged paths, and each staged diff, then
 * applies the rules in `commit-scope.ts`. Exit 1 names every offending path
 * and the waiver; exit 2 is a usage error.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { evaluateCommitScope } from './commit-scope.ts'

const MAX_GIT_OUTPUT = 64 * 1024 * 1024

const [messagePath, ...rest] = process.argv.slice(2)
if (messagePath === undefined || rest.length > 0) {
  console.error('verify-commit-scope: usage: tsx scripts/verify-commit-scope.ts <commit-message-file>')
  process.exit(2)
}

function git(args: string[]): string {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: MAX_GIT_OUTPUT })
  if (result.status !== 0) {
    const detail = result.error?.message ?? (result.stderr.trim() || `exit status ${String(result.status)}`)
    throw new Error(`git ${args.join(' ')} failed: ${detail}`)
  }
  return result.stdout
}

const message = readFileSync(messagePath, 'utf8')
const paths = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
  .split('\0')
  .filter(path => path !== '')
const verdict = evaluateCommitScope({
  message,
  paths,
  diffFor: path => git(['diff', '--cached', '-U0', '--no-color', '--', path]),
})

if (verdict.violations.length > 0 && verdict.exception === undefined) {
  console.error(`verify-commit-scope: a ${verdict.type ?? ''}() commit may not carry this change:`)
  for (const violation of verdict.violations) console.error(`  - ${violation}`)
  console.error('Retype the commit (feat, fix, test, build, …) or add a "Scope-Exception: <reason>" trailer to the message.')
  process.exit(1)
}
if (verdict.exception !== undefined && verdict.violations.length > 0) {
  console.log(`verify-commit-scope: ${String(verdict.violations.length)} scope violation(s) waived — Scope-Exception: ${verdict.exception}`)
}
