# Agent Note: Team members can work in isolated git worktrees

Status: implemented

English | [中文](2026-09-15-agent-team-worktree-isolation.zh.md)

## Problem

Every teammate ran in the Lead's exact directory. The child session copied the parent's `cwd` verbatim, so a formatter, a code generator, or a half-finished refactor from one member was immediately visible to — and breakable by — every other one. The claim ledger denied colliding first-party writes, which is real protection, but it protects a shared working tree rather than removing the sharing. Work that rewrites files other members are reading had no way to happen off to one side.

## Decision

`create_teammate` gains `isolation`. The spawn default is `worktree`; `shared` is opt-in ([Saturn product-law defaults](2026-09-15-saturn-product-law-defaults.md)). With `worktree`, the roster checks the Lead's HEAD out into `<DSH_HOME>/worktrees/<team>/<member>` and gives the teammate that directory as its durable workspace; the checkout is recorded on the member's roster row and removed when the Team runtime disposes. The pattern is ported from SaturnBot's local adapter, which has created one detached worktree per task since it was written; its process supervision and redaction are not ported, because every argv here is fixed by the module with paths as the only variable.

A teammate's workspace reaches it through one new optional parameter on `childSessionMeta`, threaded from `ContinuableStartSpec.cwd`. Omitting it, or passing an empty string, keeps the parent's workspace, so every existing caller is unchanged.

`merge_teammate` is the only road back. It stages the checkout (`add -A`, so new files count and ignored build output does not), names every path in the resulting diff, asks the claim ledger which of those paths a peer owns, and applies the patch with `git apply`, which verifies every hunk before writing the first one. A single owned path refuses the whole merge and reports each blocked path with its holder; a diff reaching outside the Lead workspace is refused too, because ownership is recorded per workspace and cannot be checked above it. Claims are consulted through `ctx.get('claims')`, duck-typed: a deployment without the claims plugin merges unguarded rather than failing to compose.

Git is invoked with `core.autocrlf=false`. Isolation must be byte-faithful, and a checkout that rewrote line endings on the way out with a merge that rewrote them on the way back would turn a one-line change into a whole-file diff on some developers' machines and not others. A repository that genuinely wants CRLF still says so in `.gitattributes`.

## Alternatives considered

**A separate OS process or container per teammate.** Stronger isolation, but it changes the delegation model, the session log, and the approval path all at once. A worktree is filesystem isolation alone, which is the part that was missing.

**Auto-merge on teammate completion.** It would hide exactly the moment that needs a decision. Two members editing one file is information the Lead must act on, and a merge that lands silently converts it back into a surprise.

**Taking a claim automatically for every merged path.** It would make the second merge of one file fail loudly, which is desirable, but it leaves the Lead unable to edit the files it just merged until a lease it does not own lapses. Merge still consults existing claims without creating new ones. First-party writes and scanned shell mutations auto-claim through the [claims guard](2026-09-15-claims-shell-and-worktree-guard.md).

## Consequences

Worktree isolation is the spawn default. `shared` remains available when members must edit the same checkout; those roster rows read `isolation: "shared"`. A Team that uses worktree trades immediate visibility for a merge step, and the merge is where the coordination that isolation deferred is paid. Checkouts created by a process that dies without disposing its Team are left on disk under the harness home; the durable roster records their paths, so a later cleanup can find them.

## Verification

Tests run against real temporary repositories with Windows paths: a checkout is created from HEAD, its diff collected and applied, and the directory removed; an isolated teammate's live session reports the checkout as its workspace while a shared teammate reports the Lead's; a non-repository workspace refuses isolation before anything durable is written; disposal removes the checkouts. The merge tests spawn two isolated teammates that edit one file, take a real claim from inside the first teammate's checkout through the claims plugin, and prove the second teammate's merge is denied with the first named while the Lead workspace stays untouched — then merge the holder's own work successfully.
