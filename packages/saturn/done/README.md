---
description: "Per-session definition of done, with proving gated on a tool-call receipt or an independent reviewer's countersign."
kind: "package-reference"
---

# @saturnai/dsh-done

English | [中文](README.zh.md)

## Summary

One short, always-visible statement of what is being built and how we will know it is finished — and the proof that met it. This is the harness's "'Done' means proven" law made structural instead of private: `stated` is the promise, `proven` requires evidence a third party can re-check, and amending the statement always returns it to `stated`, because a changed contract must be proven on its own terms.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount `@saturnai/dsh-done` on the host roster and `@saturnai/dsh-client-ui-done` in the browser half. The command and tool children attach only when a `commands` or `tools` registry is composed; without them the plugin still folds and still instructs, it simply cannot be authored from that side.

| Piece | Role |
|---|---|
| `done` projection | folds the session log, so the contract survives resume and fork |
| `done:policy` section | the model reads the contract, or the instruction to state one, on every request |
| `/done` command | human control with no model turn |
| `set_definition_of_done` tool | how the model authors and proves it |

The durable events are `done/change` — log-only, non-surface, whole-value replace, `null` until a contract is stated — and `done/countersign`, the append-only record of one independent review.

### The proof gate

`prove` does not accept an account of the work from the agent that did it. It takes exactly one of two things.

- **`receipt`** — the `tool_call_id` of a call in this session whose recorded result was not an error: the test run, the build, the smoke check that actually happened. The session log decides, not the caller's description of it. A call that errored, a call with no result yet, an unknown id, and a call to the contract tools themselves are all refused.
- **`countersign`** — the token [`@saturnai/dsh-review`](../review/README.md) mints when an independent reviewer grades the work PASS. The token is bound to the exact statement the reviewer read, so amending the contract retires it, and a REVISE or REJECT token is refused by name.

Free text alone is refused with both paths spelled out. The human at `/done prove <evidence>` is admitted — a person attesting their own work is the principal, not a worker grading itself — and is recorded as exactly that, so a reader can tell a human attestation from a machine-checked proof.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The projection is a whole-value replace at `stateVersion: 2`: a proven contract now carries `proof`, and the state schema refuses `proven` without it in the same breath that it refuses `proven` without `evidence`. A v1 snapshot recorded a proof-less `proven` and no longer folds.

Receipt resolution walks the session's own event log for the `tool/call` naming the cited id, then its last `tool/result`, and reads `isError` off the recorded block. Countersign resolution walks the same log for the `done/countersign` record carrying the token and checks the verdict and the graded statement before it will stand as a proof. Both refusals name what would work instead, because a gate that only says no teaches nothing.

`mintCountersign` is exported for the reviewer package and appends every verdict, not only the passing ones. That is deliberate: a REVISE that left no trace would let a session re-roll reviews until one came back green.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Independent review](../review/README.md) — the reviewer that mints a countersign, and the rubric it grades against.
- [Definition-of-done chip](../../client/ui-done/README.md) — the browser half that renders the contract, its provenance, and the verdict card.
- [Multi-task mode](../orchestrate/README.md) — the policy that sends a finished result to a reviewer rather than grading it.

<a id="model-experience"></a>
## Model Experience

### The done:policy section

#### What the model sees

One of three bodies, selected by the folded contract: the absent form instructing it to state a definition of done before substantive work; the stated form naming the two proof paths and refusing its own account of the work; or the proven form, which repeats the statement, the evidence, and one sentence naming the proof it stands on, and tells the model not to reopen settled work.

#### Token effect

Fixed and small: one short body per request, always present for a live agent.

#### KV Cache effect

Prefix-stable while the contract is unchanged — an unchanged contract renders an identical string. Stating, amending, proving, or clearing replaces this section's tokens in the next request.

### The set_definition_of_done tool

#### What the model sees

The tool entry in the request catalog: `action`, `statement`, `evidence`, the `receipt` object with its `tool_call_id`, and `countersign`. The description states that the model's own account of the work is not accepted as proof, and names what is. The result is the contract as last written, including a one-line rendering of its proof.

#### Token effect

One tool schema per request while a tool registry is composed, plus each call's small result.

#### KV Cache effect

Append-only: the schema is a stable prefix contribution, and results append like any other tool result.

## Known Limitations and Deferred Work

- **A receipt proves that a call ran, not that it was the right call.** The gate checks that the cited tool call exists in this session and did not error; it cannot tell a test run from a file write. The reviewer path is the strong one, and the guidance says so.
- **Countersigns are session-scoped.** A token minted in one session cannot prove a contract in a forked or resumed sibling, because the record it resolves against lives in the originating log.
- **The human path is unchecked by construction.** `/done prove` admits any evidence line; it is recorded as a human attestation precisely so that a reader never mistakes it for a machine-checked proof.
- **`stateVersion: 2` retires v1 snapshots.** A pre-existing proven contract without provenance no longer folds, per the repository's pre-release stance on durable formats.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The [decision record](../../../.agents/notes/implemented/architecture/2026-09-15-proof-gated-done.md) explains why the durable rubric vocabulary lives here rather than in the reviewer package, and why the human command keeps its own proof kind.

</details>
