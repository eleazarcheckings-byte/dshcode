# Agent Note: Team per task, then stand by

Status: implemented

English | [中文](2026-09-15-team-per-task-then-standby.zh.md)

## Problem

Multi-task mode said "coordinate substantial work across independent specialists while making useful progress yourself" and closed with "keep trivial reads, direct edits, and tightly dependent work in the main thread." Read by a capable model, that is permission to do most of the task alone: every task can be argued into "tightly dependent", and a Lead that is also the builder is a single thread wearing the toggle's name. The policy also said nothing about what happens after the result lands, so a Lead that finished one task could reasonably roll straight into whatever it judged came next — work nobody asked for, dispatched without a prompt to anchor it.

izzy stated the intended shape on 2026-09-15: multi-task designates a team to solve the task, then goes on standby to designate another team when prompted for the next task. The composer composes teams of agents, never just one.

## Decision

The ON policy now states the shape in its first sentence and its last.

**A team per task, with a floor.** For every task the user hands it, the Lead composes a team and gives the task to it — never a single agent. A team is at least two specialists with disjoint write scopes plus the independent reviewer at the end. The floor is what makes "team" mean something: without it, one subagent plus the Lead would satisfy the letter of the rule. Size still scales to the task, and the smallest coherent team is the right one — the anti-fragmentation guardrail is kept, but it now bounds the team from above, never collapses it to one hand.

**The Lead composes; the team solves.** The line that let the Lead keep work in the main thread is gone. What stays in the Lead's own hand is the reads that lock context — the material a mandate needs — because composing a team requires knowing the task. Solving it belongs to the team.

**Then stand by.** Once the team's verified result is delivered, the Lead reports it and waits for the next prompt. It does not start the next task on its own; the next prompt gets its own freshly composed team. The independent-reviewer rule from the proof-gated-done decision is unchanged and sits between the two: build, review by someone who did not build it, deliver, stand by.

The tests pin the policy's words rather than its spirit: the team floor ("at least two"), the absence of "in the main thread", the standby ("stand by", "next prompt", "do not start the next task"), and that the OFF override carries none of it — OFF is still the user's straight thread.

## Alternatives considered

- **Enforcing the floor in code — refuse a turn that dispatched fewer than two specialists** — rejected: the orchestrate package contributes prompt text only, and the README already states that ON and OFF are guidance, not enforcement. The enforcement that matters is the proof gate, which does not care how many hands built the result, only that someone independent graded it. Counting delegations would also punish the honest case where a task genuinely has one slice and the reviewer.
- **Keeping "tightly dependent work in the main thread" as the exception** — rejected: it is the clause that swallowed the rule. A team with one specialist owning a tightly coupled slice end to end is the same outcome without the Lead becoming a worker.
- **Putting the standby rule in the harness addendum only** — rejected: the addendum reaches the Lead through `AGENTS.md`, but the `orchestrate:policy` section is the text the toggle actually moves, and a session set to OFF must not carry the rule. Both copies exist; the policy is the one the toggle governs and the tests read.
- **A "team floor" of three (two specialists plus a researcher)** — rejected: it would force a research hand onto tasks that need none, which is the fragmentation the guardrail exists to prevent.

## Consequences

A fresh session folds inactive; the ON shape above is what the toggle turns on ([Saturn product-law defaults](../feature/2026-09-15-saturn-product-law-defaults.md)). Every task in an ON session now costs at least two specialist contexts plus a reviewer context, including small tasks that a single hand could have finished sooner. That is the deliberate trade: the product's claim is a verified team result on every prompt, and the price of the floor is paid in tokens, not in trust. The standby means a session never advances the work between prompts — an operator who wants continuous progress asks for it, in a prompt, and gets a team for it.

The harness addendum's quality guardrail is restated to match: the smallest coherent team, never a single hand. The engine copies of the coordinator-stance text on saturnai.tools carry the same paragraph and are updated by the process that owns the engine.

Evidence: `packages/saturn/orchestrate/tests/policy.spec.ts` — the four `team per task, then stand by` cases fail against the previous policy text and pass against this one, through both `resolveConfig()` and the assembled prompt.
