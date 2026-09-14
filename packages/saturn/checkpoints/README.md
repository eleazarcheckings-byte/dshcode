# @saturnai/dsh-checkpoints

Per-session **code checkpoints**: a content-addressed snapshot of the files a
turn is about to change, and the one-command restore that puts them back.

The destructive half of an agent's work is the half a person cannot see coming.
So every turn that mutates the workspace opens a checkpoint **before** the first
mutation lands, and every restore records the state it is about to overwrite —
which is what makes a restore itself undoable.

    10|| | |
|---|---|
| Blob store | `<DSH_HOME>/checkpoints/blobs/<ab>/<sha256>` — content-addressed, outside the user's repository |
| Durable catalog | the `checkpoints` projection in the session log (paths + one sha-256 per file) |
| Capture | wraps `tools/execute`; records `write`, `edit`, and mutating `str_replace_editor` targets |
| Restore | `/checkpoint restore <id>` — verify the whole plan, record the current state, then write |

Recording a checkpoint never dirties a working tree, appears in a diff, or
reaches a commit: only content hashes and workspace-relative paths enter the
session log, and the bytes live under the harness home.

## What this package owns

| Piece | Role |
|---|---|
| `checkpoints` projection | folds `checkpoints/change`, so the catalog survives resume and fork |
| capture hook (`tools/execute`) | records each mutating call's target bytes before it runs |
| `/checkpoint` command | lists this session's checkpoints, and restores one |
| `.` / `./client` entries | the durable vocabulary a client row reads and restores by |

The wire value is bounded ({@link MAX_WIRE_CHECKPOINTS} newest summaries);
the fold keeps every checkpoint, so `/checkpoint` still restores an older one.

## The two vocabularies, deliberately shared

Capture names exactly the paths the turn receipt shows: first-party `write`,
`edit`, and mutating `str_replace_editor` calls. Shell redirection and
third-party writers are outside that vocabulary and outside this feature, so the
receipt and the checkpoint cannot disagree about what a turn did.

The turn is the unit both surfaces speak in. A checkpoint binds to the turn open
in the session log, so tool activity outside a turn (a command dispatch, a
delegated child) records nothing.

## Why a restore is safe

- **Whole-plan refusal.** Every recorded path is re-resolved under the live
  workspace root and re-guarded. A checkpoint recorded in another directory, a
  path that now runs through `node_modules` or `.git`, or a workspace that *is*
  the installed app refuses the restore wholesale — never partially.
- **Verify before writing.** Every recorded blob must still be present, must
  still hash to its address, and must still hold its recorded length; a path
  recorded `absent` must not have become a directory.
- **Nothing outside the recorded set.** A restore writes the recorded files and
  removes the files the record says did not exist. It never deletes anything
  else, and a path the capture could not record is reported as left alone.
- **Atomic writes.** Each file is replaced through `@deepseek-ai/dsh-atomic-write`
  (stage, then rename), so a reader sees either the old bytes or the recorded
  ones, never a half-written file.
- **Undoable.** The pre-restore checkpoint records the current bytes of exactly
  the paths the restore will touch, and its id is printed in the result.

## Honest limits

- A checkpoint covers the files a first-party mutation tool names. A file
  written by a shell command, a build step, or an out-of-workspace path is not
  recorded and not restorable.
- Files larger than the capture budget (4 MiB) are recorded as skipped and left
  alone by a restore rather than read whole into memory.
- The store is per-machine and never pruned: checkpoints accumulate under the
  harness home until someone removes them.

## Composition

Mount `@saturnai/dsh-checkpoints` on the host roster. The command attaches only
when a `commands` registry is composed; the capture hook is part of the plugin
itself. The client side reads the `checkpoints` projection through the
definition-of-done card's checkpoint row
(`@saturnai/dsh-client-ui-done`), so no second card joins the composer dock.
