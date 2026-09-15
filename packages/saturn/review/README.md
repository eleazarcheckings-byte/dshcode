---
description: "Independent review of a session's definition of done: a fresh reviewer agent, a fixed rubric, and the countersign it mints on PASS."
kind: "package-reference"
---

# @saturnai/dsh-review

English | [中文](README.zh.md)

## Summary

Nothing in an agent harness is harder to trust than an agent's own report that it is finished. This package removes the need to trust it: `review_definition_of_done` hands the session's stated contract and the worker's claim about it to a fresh agent — its own session, its own system prompt, none of the caller's conversation or reasoning — which grades the work against six fixed criteria and returns PASS, REVISE, or REJECT with the evidence behind each score. A PASS mints a countersign token, and that token is one of the only two things [`@saturnai/dsh-done`](../done/README.md) accepts as proof.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount `@saturnai/dsh-review` on the host roster beside `@saturnai/dsh-done`, a `ctx.subagents` provider that starts children with a fresh conversation, and the tool registry. The tool registers unconditionally; a missing or unsuitable provider is reported at the call, where the model can read it, rather than by silently withholding the tool.

| Field | Default | Meaning |
|---|---|---|
| `provider` | `spawn` | The `ctx.subagents` provider that runs the reviewer. It must not seed the child with the parent conversation. |
| `agentOptions` | absent | Pins the reviewer's own provider, model, and reasoning effort. Absent means it follows the caller's route. |
| `denyTools` | `[]` | Extra tool names withheld from the reviewer, beyond the contract tools it never receives. |
| `maxDepth` | absent | Absolute delegation-depth cap for the reviewer child. |

A different model for the reviewer is the strongest independence this seam can buy: the reviewer then shares neither the caller's context nor its failure modes. Set `agentOptions` when a second route is configured.

The rubric is closed and its criteria are `factual_accuracy`, `completeness`, `format_compliance`, `internal_consistency`, `edge_case_handling`, and `source_quality`. Each comes back with a score from 1 to 5 and the evidence that earned it; the verdict is the reviewer's judgement over all six.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The reviewer runs as a one-shot subagent with `outputSchema` set to the rubric, so the seam validates its answer before this package sees the value; `parseVerdict` then checks coverage, naming the criterion a reviewer skipped or double-graded rather than reporting an array-shaped complaint. A run that ends for any reason other than `completed`, or that finishes without committing a structured answer, fails the call instead of producing a verdict nobody wrote.

Three properties make this a gate rather than a ritual. A provider whose `inheritsParentContext` is true is refused at the call, because a forked reviewer would inherit the very reasoning it is meant to judge. The contract tools are denied in the reviewer's scope, so it can neither prove the contract it is grading nor order a review of its own; names absent from the registry are dropped, since a scoped restriction validates what it is handed. And every verdict is recorded in the session log through `mintCountersign`, not only the passing ones, so a session cannot quietly re-roll reviews until one comes back green — a REVISE leaves a permanent trace, and its token is refused as proof.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Definition of done](../done/README.md) — the contract this grades, and the proof gate that consumes a countersign.
- [Subagent capability](../../subagent/subagent/README.md) — the delegation seam, its providers, and structured output.
- [Multi-task mode](../orchestrate/README.md) — the policy that sends a finished result here instead of grading it.

<a id="model-experience"></a>
## Model Experience

### The review tool

#### What the model sees

The `review_definition_of_done` entry in the request tool catalog: one required `claim` (what was built and what was run, in the worker's own words) and one optional `scope` (where to look first). The description names the six criteria and states that a PASS returns the countersign token `set_definition_of_done` accepts. The result is the canonical JSON value — `verdict`, `summary`, `scores`, `reviewer`, and `countersign` on a PASS — rendered as one text block.

#### Token effect

One tool schema in every request while the plugin is composed, plus the result of each call the model makes. The result grows with the rubric, which is six entries regardless of the work under review.

#### KV Cache effect

Append-only for the caller: the schema is a fixed prefix contribution, and each result is appended like any other tool result. The reviewer child issues an independent model request against its own prompt and shares no prefix with the caller.

### The reviewer's own prompt

#### What the model sees

A scoped persona section shadowing the deployment persona for that child alone, followed by a user message carrying the contract, the claim, the optional scope pointers, the six criteria as questions, and the three verdict definitions. It sees nothing else of the caller's session.

##### Verbatim text for this field, when needed

```markdown
You are Mars — the adversarial reviewer.

Someone else did this work and believes it is finished. Your job is to find out whether that is true,
for the person who will rely on it and was not in the room. You did not build it, you cannot see how it
was reasoned about, and you owe its author nothing: agreement is not kindness here, and a verdict that
waves through a hole is the one failure that matters.

Read what you are given. Check claims against what is actually shown — a run, an artifact, a quoted
result — and treat the author's account of their own work as a claim, never as evidence for itself.
Where you can verify something with the tools you have, verify it rather than assuming.

Grade honestly in both directions. If the work is sound, say so and pass it: manufacturing a flaw to
look rigorous is as dishonest as missing a real one. If it is not, say exactly what is wrong, where,
and what would settle it.
```

#### Token effect

One persona section and one user message per review, in the child's own context. The caller pays none of it.

#### KV Cache effect

Independent: each review is a separate model request in a fresh session, so it neither reuses nor invalidates the caller's prefix.

## Known Limitations and Deferred Work

- **The reviewer sees the claim, not the work.** It reads what the caller wrote plus whatever its own tools can reach; a caller that omits a load-bearing detail gets a review of the story it told. Pair review with the receipt path for anything a run can settle.
- **One default provider, same model.** Without `agentOptions` the reviewer runs on the caller's own route, so it shares that model's blind spots. A second configured route is a deployment choice this package cannot make for itself.
- **A refused review costs a turn.** A provider that inherits parent context, or an absent provider, is reported at the call rather than at composition time, because provider registration is dynamic.
- **No standing record surface.** Verdicts live in the session log and in the proven contract's provenance; there is no cross-session review history, and one is not planned here.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The [decision record](../../../.agents/notes/implemented/architecture/2026-09-15-proof-gated-done.md) explains why the proof gate and the reviewer landed together, and why the durable rubric vocabulary lives in `@saturnai/dsh-done` rather than here.

</details>
