# Agent Note: First mutating write auto-claims

Status: implemented

English | [中文](2026-09-15-claims-auto-claim.zh.md)

## Problem

Claims denied a peer's live lease but left an unclaimed path open. Two agents that never called `claim_scope` could still collide. Requiring `claim_scope` before every edit made the lock optional in practice. A holder writing a surface it already owned must not deadlock against itself.

## Decision

The write guard and the shell guard take or refresh a session-owned lease before a scanned mutation lands. An unclaimed path is claimed on lane `auto` with the same two-hour TTL as `claim_scope`. A covering holder lease is extended in place. Peer overlap is still DENIED and nothing is written. The acting session is never treated as its own peer.

This is not auto-claim on `merge_teammate`. That alternative stays rejected in [worktree isolation](2026-09-15-agent-team-worktree-isolation.md): merging must not lock the Lead out of files it just brought back.

## Alternatives considered

- **Leave unclaimed paths open.** Rejected: the lock would remain a courtesy for anyone who skipped `claim_scope`.
- **Deny the holder when it writes again.** Rejected: that is a self-deadlock, not a lock.
- **Auto-claim every path `merge_teammate` applies.** Rejected: the Lead could not edit the files it just merged until a lease it does not own lapsed.

## Consequences

A first mutating write creates an `auto` claim the rest of the team can see and deny against. A holder writing the same surface only refreshes the clock. The shell guard still releases the ledger before the command runs. A path that leaves the session cwd is not a scope this ledger can hold.

## Verification

`packages/saturn/claims/tests/auto-claim.spec.ts` pins lane `auto`, TTL, and holder refresh. `plugin.spec.ts` and `shell-guard.spec.ts` prove a peer write is denied and the acting session's own write is not.
