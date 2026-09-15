# @saturnai/dsh-claims

Enforced workspace **claims**: a durable, TTL-leased ledger of which agent owns
which file surface, so overlapping writers are **denied before the first edit**
instead of warned after the collision.

The failure this prevents is silent. When two agents write one file the loser
does not find out at the moment of collision — the work is simply gone, and the
cost is a rebuild plus the time spent reconciling two states that both believed
they were current. `SWARM.md` §2 records that happening three times in a single
evening, and its conclusion is the design here: **ownership lives in a durable
file, never in messages**, and a claim is taken *before* the first edit.

| | |
|---|---|
| Ledger | `<DSH_HOME>/claims/ledgers/<workspace-key>.json` — one document per workspace, outside the user's repository |
| Lock | `withFileLock` around the read-modify-write; `writeFileAtomic` for the commit |
| Lease | two hours by default (`SWARM.md` §2's "taken" window), auto-released on the clock |
| Tools | `claim_scope` · `release_scope` · `claim_list` · `claim_check` |
| Policy | the `claims:policy` prompt section, carrying the protocol inline |

Taking a claim never dirties a working tree, appears in a diff, or reaches a
commit. The ledger is keyed by **workspace**, not by session, because a claim
must outlive the session that took it: that is what lets a peer read ownership
it did not witness being declared, and what lets a lane survive the restart of
the process that held it.

## Deny, not warn

This is the whole difference from the Agent Teams task board's `write_scopes`,
which are advisory in two specific ways:

1. Overlap is compared **only against tasks already `in_progress`**, so two
   `pending` tasks can both name the same file and never see each other.
2. The verdict is a string in a `warnings` array. **Nothing consults it**, so
   even a reported overlap blocks nothing.

A claim has no status to be skipped and no advisory mode to be ignored. Holding
it is the entire signal, so an untouched claim still blocks, and a collision
raises `ScopeConflictError` — the write does not happen.

## The protocol the tools enforce

1. **Before your first edit**, `claim_scope` with a lane and the exact prefixes
   you will write. A collision is **denied** — pick another lane or wait.
2. **Before each write burst**, `claim_check`. A file reported `moved` changed
   since the ledger last observed it: re-read and rebase before writing it.
3. **The moment a unit verifies**, `release_scope`. Claims also lapse on their
   own, so an abandoned lane frees itself with no operator action.
4. **One writer per surface.** A scope you did not claim is not yours.
5. **Commit when a unit verifies.** Git is the only thing that survives a
   clobber.

## Properties this package is responsible for

| Property | Why it holds |
|---|---|
| No lost update | the read-modify-write runs under a cross-process `wx` lock |
| No half-written ledger | the commit is a rename over a temp sibling |
| Self-healing ownership | a lapsed lease is swept on every read and mutation |
| No self-deadlock | re-claiming your own lane extends it instead of colliding |
| Fail closed on bad input | an unusable scope is reported and **nothing** is claimed, so an agent never believes it holds a surface it does not |
| Fail loud on a bad ledger | a document that will not parse is never silently replaced — that would drop live claims |
| Dead-owner recovery | a lock whose recorded pid is gone is broken; a lock held by a live process is respected |
| Departure releases | `session/disposed` frees that session's lanes without waiting for the clock |

## Deliberate limits

- **Advisory against shell and third-party writers.** A claim governs the
  first-party `write` / `edit` / `str_replace_editor` vocabulary that tools
  dispatch through. `bash` redirection and an editor outside the harness bypass
  it, exactly as they bypass the checkpoint capture hook.
- **Scopes are prefixes, not globs.** `src/api` covers that subtree; there is no
  wildcard language, deliberately, because a pattern is harder to reason about
  than a prefix when the question is "do these two collide?".
- **Ownership is cooperative at the tool boundary.** The ledger denies a claim;
  it does not intercept a write to an unclaimed surface. An agent that never
  calls `claim_scope` is not stopped by this package — the policy section is how
  the protocol reaches the model.
