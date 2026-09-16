/**
 * Pure rules for the commit-type scope gate: a commit's conventional type must
 * match what it stages. A `docs()` commit may touch source only in comment
 * lines (JSDoc completeness); a `chore()` commit may not stage `src/` or
 * `tests/` code at all. A `Scope-Exception: <reason>` trailer waives the rule
 * with a reason that stays visible in history. The git-facing half lives in
 * `verify-commit-scope.ts`; this module reads no repository so the rules can
 * be exercised from fixtures.
 */

/** Conventional-commit header: `type(scope)!: subject`. */
const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?!?: (?<subject>.+)$/u
/** Code under a `src/` or `tests/` directory, by extension. */
const LOGIC_PATH = /(?:^|\/)(?:src|tests)\/.*\.[cm]?[jt]sx?$/u
/** The waiver trailer: one line, reason required. */
const EXCEPTION = /^Scope-Exception:[ \t]*(?<reason>\S.*?)[ \t]*$/mu
/** A changed line that is a comment or blank: a line comment, a block-comment opener, a ` * ` body or closer line, or nothing. */
const COMMENT_LINE = /^\s*(?:\/\/.*|\/\*.*|\*.*|)$/u

/** The parsed first line of a commit message. */
export interface CommitHeader {
  /** Conventional type (`feat`, `docs`, …), or undefined for merges, reverts, and free-form subjects. */
  type: string | undefined
  /** Parenthesised scope, when present. */
  scope: string | undefined
  /** The text after the type, or the whole first line when untyped. */
  subject: string
}

/** What the gate needs to know about one commit. */
export interface CommitScopeInput {
  /** The full commit message. */
  message: string
  /** Repository-relative paths the commit stages (added, copied, modified, renamed). */
  paths: readonly string[]
  /** Unified diff with zero context for one staged path, requested lazily. */
  diffFor: (path: string) => string
}

/** The gate's decision for one commit. */
export interface CommitScopeVerdict {
  /** True when no rule is violated, or every violation is waived. */
  ok: boolean
  /** The conventional type the rules applied to, or undefined when untyped. */
  type: string | undefined
  /** One line per violated path; still listed when waived so the hook can print them. */
  violations: string[]
  /** The `Scope-Exception:` reason, when the message carries one. */
  exception: string | undefined
}

function normalizeNewlines(text: string): string {
  return text.replaceAll('\r\n', '\n')
}

/**
 * Parse the conventional header of a commit message.
 * @param message - The full commit message.
 * @returns The type, scope, and subject; type is undefined when the first line is not `type(scope): subject`.
 */
export function parseCommitHeader(message: string): CommitHeader {
  const first = normalizeNewlines(message).split('\n', 1)[0] ?? ''
  const groups = HEADER.exec(first)?.groups
  if (groups === undefined) return { type: undefined, scope: undefined, subject: first }
  return { type: groups.type, scope: groups.scope, subject: groups.subject ?? '' }
}

/**
 * Read the waiver trailer.
 * @param message - The full commit message.
 * @returns The reason after `Scope-Exception:`, or undefined when absent or empty.
 */
export function scopeException(message: string): string | undefined {
  return EXCEPTION.exec(normalizeNewlines(message))?.groups?.reason
}

/**
 * Whether a path is source or test code the gate cares about.
 * @param path - A repository-relative path with either separator.
 * @returns True for script and TypeScript files under a `src/` or `tests/` directory.
 */
export function isLogicPath(path: string): boolean {
  return LOGIC_PATH.test(path.replaceAll('\\', '/'))
}

/**
 * Whether every changed line of a unified diff is a comment or blank.
 * @param diff - `git diff -U0` output for one file; empty means no change.
 * @returns True when no added or removed line carries code.
 */
export function isCommentOnlyDiff(diff: string): boolean {
  for (const line of normalizeNewlines(diff).split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (!line.startsWith('+') && !line.startsWith('-')) continue
    if (!COMMENT_LINE.test(line.slice(1))) return false
  }
  return true
}

/**
 * Apply the scope rules to one commit.
 * @param input - The message, the staged paths, and a diff reader.
 * @returns The verdict, with every violated path named even when waived.
 */
export function evaluateCommitScope(input: CommitScopeInput): CommitScopeVerdict {
  const { type } = parseCommitHeader(input.message)
  const exception = scopeException(input.message)
  const violations: string[] = []
  if (type === 'docs' || type === 'chore') {
    for (const path of input.paths) {
      if (!isLogicPath(path)) continue
      if (type === 'docs' && isCommentOnlyDiff(input.diffFor(path))) continue
      violations.push(
        type === 'docs'
          ? `${path}: a docs() commit changes code here, not only comment lines`
          : `${path}: a chore() commit stages source or test code`,
      )
    }
  }
  return { ok: violations.length === 0 || exception !== undefined, type, violations, exception }
}
