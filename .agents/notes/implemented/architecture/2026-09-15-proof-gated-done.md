# Agent Note: Proof-gated done and the independent reviewer

Status: implemented

English | [中文](2026-09-15-proof-gated-done.zh.md)

## Problem

"'Done' means proven" was doctrine the harness stated and did not enforce. `set_definition_of_done`'s `prove` action took a free-text `evidence` string from the same agent that did the work and moved the contract to `proven` on the strength of it; nothing ran, checked, or independently confirmed anything. The multi-task policy made the same mistake one level up, instructing the Lead to "review the combined result" — the agent that dispatched the work grading it.

The result was a product whose distinguishing claim, the verdict, existed only as a word. A session could self-certify, and a reader had no way to tell a contract closed by a passing test suite from one closed by an agent's optimism.

## Decision

`prove` accepts only evidence a third party can re-check, and the writer is never the reviewer.

**Two proof paths, both durable.** A `receipt` names the `tool_call_id` of a call in this session whose recorded result was not an error; resolution walks the session's own event log for the `tool/call` and its last `tool/result` and reads `isError` off the recorded block. A `countersign` names a token minted by the new `@saturnai/dsh-review` after an independent reviewer graded the work PASS; resolution walks the log for the `done/countersign` record and checks both the verdict and the exact statement that was graded. Free text alone is refused with both paths named.

**The reviewer is structurally independent.** `review_definition_of_done` runs a one-shot subagent under the persona "Mars — adversarial reviewer" with `outputSchema` set to the rubric, so the seam validates the answer before the package sees it. A provider whose `inheritsParentContext` is true is refused at the call: a forked reviewer would inherit the reasoning it is meant to judge. The contract tools are denied in the reviewer's scope, so it can neither prove the contract nor order a review of its own. Every verdict is recorded, not only the passing ones, so a session cannot re-roll reviews until one comes back green.

**The durable vocabulary lives with the log, not with the reviewer.** `ReviewVerdict`, `ReviewCriterion`, `ReviewScore`, `CountersignRecord` and `DoneProof` are declared in `@saturnai/dsh-done/types`, whose stated job is the projection key plus the durable payload vocabulary it carries. `@saturnai/dsh-review` depends on `done` and mints through its exported `mintCountersign`; the edge runs one way, `done` works with no reviewer composed, and `ui-done` reads one projection to draw both the status and the rubric.

**The human keeps a path, and it is labelled.** `/done prove <evidence>` still admits a person's attestation — the owner of the work is the principal, not a worker grading itself — and records it as `{ kind: 'human' }`, so the chip says "attested by you" rather than implying a machine checked anything.

## Alternatives considered

- **A service seam (`ctx.doneReview`) for verification** — rejected: the countersign has to survive resume and fork, so it belongs in the session log, and a log-resolved token needs no service at all.
- **Declaring the rubric types in the reviewer package** — rejected: `done` would then depend on `review` to fold its own projection, inverting the edge and making the contract unusable without a reviewer composed.
- **Refusing free text at the `/done` command too** — rejected: it would break the chip's prove button and misclassify the one principal in the system who is entitled to attest. Labelling the attestation is the honest form.
- **Requiring the receipt to name a "test-like" tool** — rejected as unenforceable guesswork; the gate proves a call ran and did not error, the guidance asks for a run, and the README says plainly that the reviewer path is the strong one.

## Consequences

The `done` projection moves to `stateVersion: 2`: a proven contract must carry its `proof`, so a v1 snapshot recording a proof-less `proven` no longer folds — acceptable under the repository's pre-release stance on durable formats. A composition without a reviewer keeps one working proof path, the receipt. A composition with one pays a child model request per review, in the reviewer's own context rather than the caller's.

The surface changes with the mechanism: the chip carries provenance beside the status, and a countersigned contract opens the reviewer's whole rubric as a verdict card — the stamp, the reviewer, the summary, and one scored line per criterion. The multi-task policy now states the rule it was violating: the coordinator never grades its own team's work.

Evidence: `packages/saturn/review/tests/composition.spec.ts` boots the whole arrangement through the Loader from a `cordis.yml` behind a scripted mock model and walks the doctrine end to end — a prose-only proof refused, a receipt naming a real non-error tool call flipping the contract to proven, and a REVISE verdict from the fresh reviewer leaving the amended contract stated.
