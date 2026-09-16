# Agent Note: A commit's conventional type must match what it stages

Status: implemented

English | [中文](2026-09-16-commit-type-scope-gate.zh.md)

## Problem

The tests-first audit trail reads commit types. A reviewer or Mars lists `test(` commits for the RED half and `feat(`/`fix(` commits for the green half, and a `docs(`/`chore(` commit is skipped as prose. On 2026-09-15 commit `78a06d26b1`, whose subject reads `docs(saturn): re-record translation-pairing sidecars for hygiene-docs READMEs`, actually carried the whole `packages/saturn/tool-media` implementation (18 files, seven net-new `src/` modules) plus six lines of an already-committed RED spec. `git log --all` holds no `feat(` commit for tool-media, so a RED/GREEN audit reads the feature as never implemented, and the independent review of 1.2.2 filed it as a should-fix. Nothing in the repository stopped the mislabel at the moment it happened.

## Decision

A lefthook `commit-msg` job runs `scripts/verify-commit-scope.ts` with the message file git passes. The rules live in `scripts/commit-scope.ts`, which reads no repository so fixtures can drive it:

- A `docs()` commit may stage a file under `src/` or `tests/` only when every added or removed line of its zero-context diff is a comment or blank. JSDoc-completeness commits stay `docs(`; a code change under a `docs(` subject is refused.
- A `chore()` commit may not stage any script or TypeScript file under `src/` or `tests/`. Manifests, lockfiles, configs, generated catalogs, notices, and notes are still chores.
- `feat`, `fix`, `test`, `build`, and untyped subjects (merges, reverts, free-form) are not judged.
- A `Scope-Exception: <reason>` trailer waives the violations; the hook prints the reason on success, and the trailer stays in the message so the waiver is visible to any later audit. An empty reason does not waive.

The hook names every offending path on stderr and exits 1. Installation is the existing `node scripts/install-lefthook.mjs` path; `lefthook install --force` regenerates the worktree-local hooks from `lefthook.yml`, so the job appears in every worktree that reinstalls.

## Alternatives considered

**commitlint or another message linter.** Rejected: a message-only linter cannot see the staged diff, and the defect is precisely a message that disagrees with the diff. It would also add a dependency for one rule.

**Block every `src/` change under `docs(`.** Rejected: three of the last sixty commits on master are JSDoc-completeness passes that edit source files in comment lines only and are correctly typed `docs(`. Refusing those would push real documentation work into `fix(` and make the trail less honest, not more.

**A `pre-commit` job instead of `commit-msg`.** Rejected: the type is not known until the message exists. `commit-msg` is the first hook that sees both the message and the staged index.

**A CI-side history audit.** Rejected as the only line: it catches the mislabel after it is on master, when rewriting history is already off the table. The commit-time hook is the cheap first line; a history audit can still be added later.

## Consequences

Authors who mislabel a commit are refused locally with the path and the two remedies. A `Scope-Exception:` trailer is the escape hatch, and it is deliberately loud: the reason prints at commit time and remains in `git log`. `git commit --no-verify` still bypasses the hook, as it bypasses every local hook; the repository's stance on that is unchanged. The gate is not retroactive and does not re-type existing commits; `78a06d26b1` is disclosed in the tool-media Agent Note instead.

Verification: `node_modules/.bin/vitest run scripts/commit-scope.spec.ts` covers the header parser, the trailer, the path and comment-only classifiers, the verdict for every commit type, and the CLI end to end in a temporary git repository (exit 1 naming the path for `chore(` over staged source, exit 0 for `feat(`, the printed waiver for a `Scope-Exception:`, exit 2 on usage). The spec was committed RED before the implementation.
