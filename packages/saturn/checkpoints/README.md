---
description: "Per-session code checkpoints: a content-addressed snapshot of the files a turn is about to mutate, and the one-command restore that puts them back."
kind: "package-reference"
---

# @saturnai/dsh-checkpoints

English | [中文](README.zh.md)

## Summary

Per-session **code checkpoints**: a content-addressed snapshot of the files a turn is about to change, and the one-command restore that puts them back. The destructive half of an agent's work is the half a person cannot see coming, so every turn that mutates the workspace opens a checkpoint **before** the first mutation lands, and every restore records the state it is about to overwrite — which is what makes a restore itself undoable.

## Table of Contents

- [What this package owns](#what-this-package-owns)
- [The two vocabularies, deliberately shared](#the-two-vocabularies-deliberately-shared)
- [Why a restore is safe](#why-a-restore-is-safe)
- [Composition](#composition)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-this-package-owns"></a>
## What this package owns

| Piece | Role |
|---|---|
| Blob store | `<DSH_HOME>/checkpoints/blobs/<ab>/<sha256>` — content-addressed, outside the user's repository |
| Durable catalog | the `checkpoints` projection in the session log (paths + one sha-256 per file) |
| Capture | wraps `tools/execute`; records `write`, `edit`, and mutating `str_replace_editor` targets |
| Restore | `/checkpoint restore <id>` — verify the whole plan, record the current state, then write |

Recording a checkpoint never dirties a working tree, appears in a diff, or reaches a commit: only content hashes and workspace-relative paths enter the session log, and the bytes live under the harness home. The wire value is bounded ({@link MAX_WIRE_CHECKPOINTS} newest summaries); the fold keeps every checkpoint, so `/checkpoint` still restores an older one.

-----

<a id="the-two-vocabularies-deliberately-shared"></a>
## The two vocabularies, deliberately shared

Capture names exactly the paths the turn receipt shows: first-party `write`, `edit`, and mutating `str_replace_editor` calls. Shell redirection and third-party writers are outside that vocabulary and outside this feature, so the receipt and the checkpoint cannot disagree about what a turn did.

The turn is the unit both surfaces speak in. A checkpoint binds to the turn open in the session log, so tool activity outside a turn (a command dispatch, a delegated child) records nothing.

-----

<a id="why-a-restore-is-safe"></a>
## Why a restore is safe

- **Whole-plan refusal.** Every recorded path is re-resolved under the live workspace root and re-guarded. A checkpoint recorded in another directory, a path that now runs through `node_modules` or `.git`, or a workspace that *is* the installed app refuses the restore wholesale — never partially.
- **Verify before writing.** Every recorded blob must still be present, must still hash to its address, and must still hold its recorded length; a path recorded `absent` must not have become a directory.
- **Nothing outside the recorded set.** A restore writes the recorded files and removes the files the record says did not exist. It never deletes anything else, and a path the capture could not record is reported as left alone.
- **Atomic writes.** Each file is replaced through `@deepseek-ai/dsh-atomic-write` (stage, then rename), so a reader sees either the old bytes or the recorded ones, never a half-written file.
- **Undoable.** The pre-restore checkpoint records the current bytes of exactly the paths the restore will touch, and its id is printed in the result.

-----

<a id="composition"></a>
## Composition

Mount `@saturnai/dsh-checkpoints` on the host roster. The command attaches only when a `commands` registry is composed; the capture hook is part of the plugin itself. The client side reads the `checkpoints` projection through the definition-of-done card's checkpoint row (`@saturnai/dsh-client-ui-done`), so no second card joins the composer dock.

-----

<a id="model-experience"></a>
## Model Experience

### Mutating-tool capture

#### What the model sees

Nothing new in the prompt or tool schemas. Capture rides `tools/execute` as a before-hook on the existing `write`, `edit`, and mutating `str_replace_editor` calls; the model's own tool results are unchanged, and the `/checkpoint` command is a human-facing surface the model never issues on its own.

#### Token effect

Zero. Capture writes a content-addressed blob and a `checkpoints/change` log entry; neither enters the assembled prompt. A restore's result line (the id and the touched paths) reaches the model only if a human relays it back into the conversation.

#### KV Cache effect

None directly: nothing here changes the request stream. A restore that reverts the very files a later turn reads can change what a subsequent tool call returns, which is an ordinary cache-breaking content change, not a checkpoint-specific effect.

## Known Limitations and Deferred Work

- A checkpoint covers the files a first-party mutation tool names. A file written by a shell command, a build step, or an out-of-workspace path is not recorded and not restorable.
- Files larger than the capture budget (4 MiB) are recorded as skipped and left alone by a restore rather than read whole into memory.
- The store is per-machine and never pruned: checkpoints accumulate under the harness home until someone removes them.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
