# Agent Note: The terminal guard stopped guessing its shell, and an isolated teammate stands where its Lead stands

Status: implemented

English | [中文](2026-09-15-claims-terminal-dialect-and-worktree-subdirectory.zh.md)

## Problem

Two narrow holes defeated the guard that worktree isolation exists to provide, and both were silent.

The shell half of the claim write-guard chose which vocabulary to read a `terminal_send` line in from `process.platform`. A terminal carries whichever shell the session opened, and Git Bash on Windows is as ordinary as `pwsh` on Linux, so on every Windows host the entire POSIX mutator table went unconsulted: `sed -i`, `truncate`, `tee`, `patch`, `dd`, `ln`, and `chmod` typed at a terminal reached a peer's claimed file unguarded, with the mirror-image hole for a PowerShell session on a POSIX host. Redirections were still caught, which is exactly what made the gap hard to notice.

Separately, `git worktree add` checks out the whole repository, and the isolated teammate was handed the checkout ROOT regardless of where its Lead stood. Claims are recorded against a workspace, so a Lead whose session sat in `<repo>/app` asked the ledger about `<repo>/app` while its teammate's leases were filed under `<repo>`. The two never met: a teammate's claim was invisible to `merge_teammate`, which then reported no conflict and applied straight over it. The feature meant to prevent lost work produced it.

## Decision

`ShellCall` carries `dialects` rather than one `dialect`. A dedicated tool names exactly one, because its executable is a fact — `bash` runs bash, `pwsh` runs PowerShell. A terminal names both, and the guard takes the union of what either reading says the line writes. The cost is an occasional extra question about a name that means nothing in the other shell; the cost of the guess was a peer's file.

`WorktreeManager.checkoutWorkspace()` maps the Lead's workspace into the checkout by its repository-relative depth and creates the directory when the base commit lacks it. The roster hands the child that directory instead of the checkout root, so its claim space resolves — through the existing linked-worktree mapping — to the same `<repo>/<sub>` the Lead asks about. The checkout root stays on the roster row, because collecting and removing still operate on the whole checkout.

## Alternatives considered

**Detect the terminal's shell from the backend configuration.** `terminal-bash` does record a `shellDialect`, but the guard sits on the tool bus with a session id and no handle on the backend that opened it, and a wrong answer there fails open. Reading both vocabularies needs no lookup and cannot fail open.

**Give bash and pwsh the union too.** Their dialect is not a guess, and widening it would deny on PowerShell aliases (`sc`, `ni`, `si`) that are ordinary program names on POSIX. The ambiguity is the terminal's alone.

**Key the ledger by repository root for every session.** It would close the divergence by erasing the distinction, but it also merges the ledgers of two agents deliberately working in different subdirectories of one repository — a behavior change for every existing user to fix a case only isolation creates.

**Collect only the child's subdirectory at merge.** The merge already refuses a diff reaching above the Lead's workspace, with the paths named; narrowing the collection would hide that refusal instead of reporting it.

## Consequences

A terminal line naming a peer-claimed path is denied on every platform. An isolated teammate of a Lead working below the repository root shares one claim space with it, so `merge_teammate` sees peer leases and refuses. Repository-root Leads — the common case — are unaffected: the mapped directory is the checkout root.

## Verification

Two new suites, run RED before the fix. `packages/saturn/claims/tests/shell-guard-dialects.spec.ts` stubs the platform in each case, so it proves the same contract on any machine: six terminal mutations denied across both vocabularies on both platforms, four read-only lines still admitted, the holder's own mutation admitted, and `bash` keeping its declared dialect. `packages/saturn/agent-team/tests/worktree-subdirectory.spec.ts` builds a real repository whose files live under `app/`, puts the Lead in `<repo>/app`, and asserts the child workspace lands at `<checkout>/app` and that a claim taken there denies a peer's merge while the holder's own merge lands. `vitest run packages/saturn/agent-team packages/saturn/tool-agent-team packages/saturn/claims packages/subagent/subagent` reports 39 files / 798 passed, 2 skipped; `tsc --noEmit` is clean for all four projects.

## Model experience

No tool surface changed. A model typing a mutating command at a terminal now receives the same named-holder refusal it already received from `bash` and `pwsh`, and a Lead merging an isolated teammate from a subdirectory now receives the denial with the blocked paths instead of a silent overwrite.
