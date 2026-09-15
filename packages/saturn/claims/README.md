# @saturnai/dsh-claims

Workspace file ownership shared across agent sessions, with durable leases under `<DSH_HOME>/claims/ledgers`.

## Ownership and writes

`claim_scope` acquires exclusive file or directory prefixes. Overlapping acquisition is denied, including canonical aliases when the filesystem service is mounted. Reclaiming the same lane extends its lease. `claim_list` exposes current holders and expiry; `claim_check` reports metadata drift and rebases the holder's observations; `release_scope` frees the files. Only the owning session may release or rebase its claim.

With a mounted filesystem service, first-party `write`, `edit`, and mutating `str_replace_editor` calls are denied before dispatch when their resolved target overlaps another session's live claim. The guard holds the cross-process ledger lock through dispatch, preventing another process from acquiring the scope between the check and the write. The holder can write its own files. Reads and writes outside peer-owned scopes remain available without requiring a claim for every single-agent edit.

## Model Experience

The prompt directs each writer to acquire its exact scopes, check for drift before a write burst, re-read changed files, and release ownership after verification. A denial names the holder, lane, claim id, and remaining lease, with an instruction to request a handoff or choose another scope. Shared Team task assignments describe planned work; they do not grant file ownership.

## Durability

The ledger lives outside the user's working tree. Atomic replacement prevents partial JSON, and the writer lock serializes acquisition, release, expiry and protected writes across processes. Malformed persisted ledgers fail closed. Leases expire on the clock; session disposal releases that session's claims. Lock recovery only removes dead-owner or sufficiently old ownerless locks, preserving locks owned by a live process.

## Limits

- Shell redirection, formatters, generators, external editors, and third-party tool names bypass the first-party tool guard. Coordinate them explicitly; the policy forbids using them to bypass a denial.
- Scopes are workspace-relative directory prefixes or exact filenames, not globs. The ledger is keyed by the session workspace root; sessions using distinct roots have distinct ledgers.
- The guard uses filesystem target resolution and containment to recognize case and symlink aliases within one workspace. External mutation of symlinks during a tool call remains outside the ownership protocol.
- Claim drift uses modification time and size. Directory metadata cannot detect every descendant edit; the filesystem observation policy remains responsible for stale file-content checks.
- Protected mutations serialize for one workspace. They retain existing cancellation, approval, filesystem and sandbox policies.

The [runtime decision](../../../.agents/notes/implemented/bug-fix/2026-09-14-saturn-team-file-ownership.md) records the tradeoff. No separate runtime invariant installer is published: the ledger transaction and tool-dispatch guard enforce the relationship at each mutation, and behavioral tests exercise the denied writes directly.
