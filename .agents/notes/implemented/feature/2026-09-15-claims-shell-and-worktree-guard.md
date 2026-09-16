# Agent Note: Claims guard shell writes and span a repository's worktrees

Status: implemented

English | [中文](2026-09-15-claims-shell-and-worktree-guard.zh.md)

## Problem

The claim ledger denied colliding writes through `write`, `edit`, and `str_replace_editor`, and the Agent Teams policy said the quiet part out loud: "Bash, formatters, code generators, and scripts are not fully protected by the filesystem version guard." A lock with a documented way around it is a lock writers route around, and `echo x > src/app.ts` was that way around.

The second problem arrived with isolated checkouts. The ledger was keyed by the session's working directory, so two teammates in two linked worktrees of one repository would have had two private ledgers, each certain it owned `src/app.ts`. That is the original lost-work collision, arriving later and costing more, because by then both diffs are written.

## Decision

A second guard on the `tools/execute` bus reads `bash`, `pwsh`, and `terminal_send`. It does not interpret commands — nothing here predicts what `node build.mjs` will touch. It scans for what argv can prove: an output redirection target, and the operands of a command whose entire purpose is to change files, in both the POSIX and PowerShell vocabularies, with named-parameter awareness so `Set-Content -Path src/app.ts -Value 'text'` yields the path and not the text. Targets are resolved against the command's own working directory, projected into claim space, and dropped when they land outside it.

Reads stay free, deliberately. A guard that denied `cat` would be routed around within a day. And unlike the first-party guard, this one does not hold the ledger transaction across dispatch: the lock is cross-process, and a build holding it would stall every other session's claims for the length of the build. The check reads, decides, and releases before the command starts, which leaves a narrow window in which a claim taken during the check is missed — a much smaller cost than a stalled lock.

Claim space is the second half. When a session's working directory is a linked `git worktree`, its claims are recorded against the corresponding directory under the repository's main worktree, detected through git's own `.git` file and `commondir` record, cached per directory, and falling back to the directory itself for anything unreadable. Scopes therefore name repository-relative surfaces shared by every checkout. The first-party guard now resolves the claimed scopes in claim space while resolving the model's path in the session's own checkout, which is what lets an isolated teammate write freely inside its worktree while the shared surface stays owned.

A first mutating first-party write, or a scanned shell mutation, of an unclaimed path auto-takes a lease for the acting session on lane `auto` with the same two-hour TTL as `claim_scope`. Writing a surface the session already holds extends that lease and never deadlocks against itself. A peer's live claim is still denied before any byte lands.

`ctx.claims` publishes the ledger as a reader for host code that writes a workspace on someone else's behalf, which is how Agent Teams' `merge_teammate` learns which paths of an incoming diff a peer owns. That reader takes no leases. Write and shell guards auto-take a session lease on first unclaimed mutation; merge still consults without creating one.

## Alternatives considered

**Parsing the command with a real shell grammar.** More precise on exotic syntax, and a dependency plus a much larger surface to be wrong in. The scan is deliberately shallow and its limits are stated in the policy the model reads.

**Denying every shell command that names a claimed path, reads included.** Safe-looking and unusable: inspection of a peer's files is normal and necessary, and blocking it teaches writers to disable the guard.

**Keying the ledger by repository root for all sessions.** It would also unify worktrees, but it would silently merge the ledgers of two agents working in different subdirectories of one repository — a behavior change for every existing user, to fix a case only linked worktrees have.

## Consequences

A shell command that names a peer's claimed file is now refused with the holder, the lane, the lease, and the exact blocked paths, and the standing policy says so instead of admitting the gap. Every checkout of one repository shares one set of lanes, so worktree isolation and claims compose instead of cancelling out. A command whose writes are invisible to argv — a formatter, a generator, a script — is still uncovered, and the policy still names that as coordination the agents owe each other.

## Verification

The suite drives the real tool runtime with shell-shaped fixtures that actually perform the write, so a guard that failed to deny is visible as changed bytes rather than as a missing error: redirections, `rm`, `cp`, `sed -i`, `Set-Content`, `Remove-Item`, `Out-File`, and a terminal write are each denied against a peer-owned file, the holder's own command is admitted, four read-only commands are admitted, a target outside the workspace is ignored, and a relative target resolves against the command's `workdir`. Claim space is proved against real repositories with real linked worktrees: a worktree resolves to its main checkout, and a claim taken in one worktree denies a second worktree and is visible to a session in the repository itself.
