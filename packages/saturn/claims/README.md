---
description: "Enforced workspace file ownership across agent sessions: durable TTL leases, denied colliding writes, and a shell-aware guard."
kind: "package-reference"
---

# @saturnai/dsh-claims

English | [中文](README.zh.md)

## Summary

`@saturnai/dsh-claims` makes file ownership a lock instead of a courtesy. An agent takes a lease on the exact file or directory prefixes it is about to write, and any other session that tries to write those paths is denied before its first byte lands — through the first-party `write`, `edit`, and `str_replace_editor` tools, and through the `bash`, `pwsh`, and `terminal` commands whose arguments name a file. The ledger lives under `<DSH_HOME>/claims/ledgers`, outside every working tree, so a lease outlives the session that took it and two processes editing one repository read the same bytes.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it in any deployment where more than one agent can write one workspace: a Team of parallel teammates, several chats driving separate cells of the same repository, or a single agent that simply wants to declare a surface before touching it. It injects `tools` and `systemPrompt`, uses `fs` when one is mounted, and needs no configuration.

### The protocol

`claim_scope` takes exclusive workspace-relative prefixes for a named lane; an overlap with a live **peer** claim is DENIED and nothing is taken. A first mutating write (or a scanned shell mutation) of an unclaimed path auto-takes a claim for the acting session, with the same two-hour lease; writing a surface the session already holds extends that lease and never deadlocks against itself. `claim_check` re-stats the claim's files and reports any that moved, so a holder rebases before a write burst instead of writing a buffer it read minutes ago. `release_scope` frees a lane the moment its unit verifies, and `claim_list` shows every live holder with its remaining lease. A lease lapses on its own after two hours by default, and disposing a session releases everything it held.

### What is enforced

A peer's live claim denies a mutating first-party tool call before dispatch, and the ledger transaction is held across that dispatch so no other process can take the scope between the check and the write. An unclaimed path is not left open: the acting session auto-takes a lease on the mutation path (the same two-hour TTL as `claim_scope`) unless it already holds a covering claim, in which case the lease is extended. A shell call is scanned for what its arguments can prove: an output redirection target, and the operands of a command whose purpose is to change files (`rm`, `mv`, `cp`, `tee`, `sed -i`, `git checkout`, `Set-Content`, `Remove-Item`, and their kin). Scanned shell mutations auto-claim the same way; the shell check still releases the ledger before the command runs, because a build holding a cross-process lock would stall every other session's claims for its whole duration. `bash` and `pwsh` are read in their own vocabulary, because their executable is a fact; a `terminal` line is read in both, because the shell behind a terminal is whatever the session opened and the host platform does not decide it. Reads are never blocked.

### Claim space

A claim names a surface in the repository, not in one checkout of it. When a session's working directory is a linked `git worktree`, its claims are recorded against the corresponding directory under the repository's main worktree, so every checkout shares one ledger and one set of lanes. This is what lets an isolated Agent Teams teammate coordinate with the rest of the team while keeping its own files to itself: inside its own checkout it writes freely, and the shared surface stays owned.

<a id="understand-the-implementation"></a>
## Understand the implementation

`ledger.ts` owns the arithmetic — scope normalization, component-aware overlap, expiry, and the view the tools render. `store.ts` owns durability: one JSON document per workspace, replaced atomically under a cross-process writer lock that a contender may break only when the lock's recorded owner is provably gone. `write-guard.ts` and `shell-guard.ts` are the two enforcement points on the `tools/execute` bus; both auto-claim an unclaimed mutation path for the acting session (TTL unchanged) and extend a covering holder lease. `workspace.ts` resolves claim space from git's own `commondir` record, falling back to the directory itself for anything it cannot read. `service.ts` publishes `ctx.claims`, a read-only face for host code that writes a workspace on someone else's behalf — Agent Teams' `merge_teammate` asks it which paths of an incoming diff a peer already owns.

## Model Experience

### Claim tools and the standing protocol

#### What the model sees

A standing policy section states the protocol as rules it can act on: `claim_scope` before the first edit (or rely on the first mutating write to auto-take the lease), `claim_check` before each write burst, `release_scope` on verification, one writer per surface, and that a shell command is not a way around a denial. A refusal names the holder, the lane, the claim id, the remaining minutes, and the exact blocked paths, then says what to do instead — request a handoff, narrow the scope, or wait for the lease.

#### Token effect

Four compact tools and one policy section of roughly 350 tokens. Tool results are single-line JSON; a denial costs a few dozen tokens and replaces the far more expensive discovery that two agents overwrote each other.

#### KV Cache effect

The policy section is static and sits with the other standing sections, so it is cached with the prompt prefix. Claim results arrive as ordinary tool results and never rewrite earlier turns.

## Known Limitations and Deferred Work

- A shell command is guarded by what its arguments can show. A formatter, a code generator, a build script, or an interpreter that writes files from inside a program is out of reach of static reading and still needs explicit coordination; the policy forbids using one to get around a denial.
- Scopes are directory prefixes or exact filenames, never globs. A glob in a shell command is narrowed to its literal parent directory before the check.
- Claim drift is observed through modification time and size. Directory metadata cannot detect every descendant edit, and the filesystem observation policy remains responsible for stale file-content checks.
- Claim space is derived once per directory and cached for the life of the process, so a repository that becomes a linked worktree while the harness runs keeps its earlier ledger until restart.
- The first-party guard holds the ledger lock across dispatch and therefore serializes protected mutations within one workspace. The shell guard deliberately does not, which leaves a narrow window in which a claim taken during the check is missed.

### Dev Note

The [runtime decision](../../../.agents/notes/implemented/bug-fix/2026-09-14-saturn-team-file-ownership.md) records the original tradeoff, [worktree isolation](../../../.agents/notes/implemented/feature/2026-09-15-agent-team-worktree-isolation.md) records why the ledger became repository-keyed, and [first-write auto-claim](../../../.agents/notes/implemented/feature/2026-09-15-claims-auto-claim.md) records why an unclaimed mutation takes lane `auto`. No runtime invariant installer is published: the ledger transaction and the two dispatch guards enforce the relation at each mutation, and behavioral tests exercise the denied writes directly.
