# Agent Note: model-router — Mars r2 fix (codex resolution was inverted; wrapper dependency declaration restored)

Status: implemented

English | [中文](2026-09-15-model-router-mars-r2-fixes.zh.md)

## Problem

Mars's second review of C6 (`.../scratchpad/review/C6-model-router-providers-r2.md`) returned REVISE. The load-bearing finding (F1-r2): the r1 fix's `harnessCliResolvable` stage 2 resolved a harness's CLI dependency with a single bare `require.resolve(cliPackage)` call. That call permanently fails for `@openai/codex` — a bin-only package (`{ bin: { codex: ... } }`, no `main`, no `exports`) — because a bare specifier has nothing to load as the package's main module and Node throws `MODULE_NOT_FOUND`. So `harnessAvailable('codex')` reported `false` even when `@openai/codex` was genuinely installed inside `dsh-subagent-codex`'s own `node_modules`, inverting SPEC §3 C6(3): the row now self-hid when the CLI was *present*, not absent. `claude-code` was unaffected only because `@anthropic-ai/claude-agent-sdk` happens to declare a real `.` export the bare specifier resolves through. A secondary finding (F2-r2): the r1 fix had removed `@deepseek-ai/dsh-subagent-codex` / `-claude-code` from `optionalDependencies`, leaving them only in `devDependencies` — stage 1's resolution (anchored at `model-router`'s own module) then depended on an undeclared edge that a production, pruned install would not carry.

## Decision

- **Stage 2 now tries both specifier forms.** `harnessCliResolvable(resolver, subagentPackage, cliPackage, createRequireFn)` resolves `cliPackage` bare OR as `${cliPackage}/package.json` from a `require` anchored at the wrapper's manifest, accepting either. Confirmed against the real installed manifests this round: `@openai/codex` (no `main`/`exports`) resolves only via `/package.json`; `@anthropic-ai/claude-agent-sdk` (an `exports` map with `.` but no `./package.json`) resolves only bare, throwing `ERR_PACKAGE_PATH_NOT_EXPORTED` on the subpath. Trying both forms answers "is the CLI dependency present" without hard-coding a specifier shape per harness — chosen over a per-row `HARNESS_CLI_PACKAGE` table carrying a pre-picked form, which would silently break again the next time a wrapped CLI ships a differently-shaped manifest.
- **Restored `optionalDependencies`.** `@deepseek-ai/dsh-subagent-codex` and `@deepseek-ai/dsh-subagent-claude-code` moved from `devDependencies` back to `optionalDependencies` of `@saturnai/dsh-model-router` — the accurate declaration for a dependency this package's own code resolves at runtime but tolerates the absence of. README (+ zh) documents the read-only evidence gathered this round from the installed desktop app's `resources/app/node_modules`: it is a single flat directory (electron-builder's packaging, not pnpm's isolated per-package store), so `optionalDependencies` is the correct declaration for `pnpm install` and any future isolated-install packaging path, but is not the only thing standing between stage 1 and a false negative in the flat layout the app currently ships with — neither wrapper package was present in that tree at inspection time, so the packaged, toggle-on case remains unobserved end-to-end.
- **README/README.zh corrected.** The claim that stage 2 uses "the same resolution order Node itself would use to load the CLI from inside the wrapper" was false for `codex` (a bare specifier is not how the CLI's own `bin` entry point is reached at all) — replaced with a description of the actual dual-form probe and why each harness needs the form it needs. Re-recorded with `pnpm run verify-translation-pairing --write`.
- **New test file, not an edit to the already-committed RED file.** `tests/harness-cli-resolution.spec.ts` (Mars r1's RED commit) was left untouched; the round-3 fix instructions described a stray 45-line uncommitted addition to that file from a stopped duplicate agent, but by the time this round started the file was already clean and matched `HEAD` exactly (git status and `git diff HEAD` both empty; no stash, no reflog entry) — the addition was gone, most likely swept up in the repo-wide uncommitted-edit wipe this session's shared context warns a sibling cell caused twice. Rather than reconstruct guesswork, a new file, `tests/harness-cli-resolution-real-env.spec.ts`, was written from scratch expressing the real-environment, no-fakes cases Mars r2 asked for, committed RED first against the pre-fix code (the codex case failed; confirmed), then left in place through the fix.

## Deviations from the fix list (declared, not silent)

- **Chose "try both forms" over "one form per `HARNESS_CLI_PACKAGE` row"** — the fix instructions offered either. A per-row form is slightly more explicit about *why* each harness resolves the way it does, but ties correctness to a table someone has to remember to update whenever a wrapped CLI's manifest shape changes; trying both forms is self-correcting and costs at most one extra synchronous `require.resolve` call per harness per process (cached after the first probe, same as before).
- **Did not restore the stray test hunk** — there was nothing on disk to restore (see Decision above); a new RED file was written instead, per the fix instructions' fallback branch.

## Alternatives considered

**Special-case `codex` in `harnessCliResolvable` with an `if (harness === 'codex') use '/package.json'` branch.** Rejected: the function takes `cliPackage` as an opaque string precisely so it does not need to know which harness it is probing; a per-harness branch would leak that knowledge back in and still not cover a future third harness with its own manifest shape.

**Drop the `/package.json` subpath probe and instead resolve `${cliPackage}/bin/codex.js` (or similar) directly from the package's declared `bin` field.** Rejected: it requires reading and parsing the target package's own `package.json` to find the `bin` path per harness — exactly the file-system read `packageResolvable`'s `require.resolve` already does generically, and it would need a different literal path per harness's own `bin` layout, which is worse than trying two fixed, harness-agnostic forms.

## Consequences

**Cost:** `harnessCliResolvable` now makes up to two `require.resolve` calls for its stage-2 check instead of one (still cached per process by `harnessAvailable`, so the added cost is at most once per harness per process lifetime). No public API or constructor signature changed.

**Bought:** `harnessAvailable('codex')` now reports `true` in this checkout (confirmed: 19/19 tests green, including the new real-environment file), matching SPEC §3 C6(3)'s actual intent — the row mounts once the toggle is on and the CLI is genuinely installed, and continues to self-hide only when the CLI is genuinely absent, for both shipped harnesses.

## Testing

New: `tests/harness-cli-resolution-real-env.spec.ts` (3 tests, no fakes — real `createRequire` against the real installed manifests of `@openai/codex` and `@anthropic-ai/claude-agent-sdk`). Confirmed RED first, committed separately (`test(saturn): RED -- real-environment coverage for Mars r2 F1-r2`): the codex case failed against the pre-fix single-form resolution (`expected false to be true`); the claude-code and negative cases already passed pre-fix (documented in the RED commit message as expected, not overlooked). Implemented the dual-form stage-2 probe; all 3 new tests plus the existing 16 in the package pass (19/19). `node_modules/.bin/tsc -p packages/saturn/model-router/tsconfig.json --noEmit` is clean. `node_modules/.bin/vitest run packages/saturn/model-router packages/bundle/base` — all green (see report_path for verbatim counts and command output).

## Deferred

Unchanged from the r1 note: the `tsconfig.base.json` paths entry, the `pnpm-lock.yaml` refresh for `packages/bundle/base` / `packages/bundle/web-app`'s dependencies (this round's `optionalDependencies` restore adds to that same pending refresh), wiring `ctx.modelRouter.resolve('specialist')` into the real `tool-subagent` spawn path and SaturnBot, and the `settings.plugin.item` client card for `saturn-model-router`.
