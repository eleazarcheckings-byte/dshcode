---
description: "Logged per-session multi-task mode: the policy the coordinator reads, and the toggle that changes it."
kind: "package-reference"
---

# @saturnai/dsh-orchestrate

English | [中文](README.zh.md)

## Summary

The session multi-task setting is logged and defaults to ON. `/orchestrate [on|off]` changes it, a change made during an active turn applies at the next accepted step, and resuming or forking a session retains its logged selection. The setting moves guidance, never the tool catalog.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount `@saturnai/dsh-orchestrate` on the host roster; the `/orchestrate` command attaches when a command registry is composed, and `@saturnai/dsh-client-ui-orchestrate` provides the composer toggle. Deployments may replace either body by supplying non-empty `on` and `off` strings.

ON states the shape of the mode first: the coordinator is the composer, and every task the user hands it gets a team — never a single agent. A team is at least two specialists with disjoint write scopes plus the independent reviewer, sized to the task, the smallest coherent team being the right one. It then directs the coordinator to assign independent work with concrete deliverables, context, disjoint file scopes, and verification requirements, preferring named Team members for ongoing shared work and one-shot subagents for bounded independent work, and states the rule that makes the arrangement trustworthy: the coordinator never grades its own team's work. When the pieces are in, the combined result goes to `review_definition_of_done`, which runs a fresh reviewer against the definition of done, and the contract is proven with that review's countersign or with the receipt of a run — never with the coordinator's own account of how it went. Once the verified result is delivered the coordinator stands by: it reports and waits for the next prompt, which gets its own team, rather than rolling itself into the next task. The reads that lock context stay in its own hand; solving the task belongs to the team.

OFF asks the agent to work in one thread unless the user requests delegation, and says outright that this session-level instruction overrides the standing always-orchestrate posture.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The `orchestrate` projection folds the session log with `init` active, so the standing posture holds on an empty log and only an `orchestrate/mode` event turns it off. A selection made while a turn is open is held in memory and committed at the next accepted in-turn pre-step, so the logged state never changes under an in-flight request, while the section reads the pending-or-logged value — the same shape plan mode uses.

Off does not unregister the delegation tools. The request tool catalog stays stable across the toggle, per the plan-mode cache rule; only the guidance the next request reads changes.

The reviewer tool name is spelled in this package rather than imported. This package contributes prompt text only, and a dependency edge on the reviewer package to read one model-facing name would buy nothing; `@saturnai/dsh-review` owns the tool and its contract.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Independent review](../review/README.md) — the reviewer the ON policy sends a finished result to.
- [Definition of done](../done/README.md) — the contract a countersign or a receipt proves.
- [Agent Teams](../agent-team/README.md) — the named teammates the ON policy prefers for ongoing shared work.

<a id="model-experience"></a>
## Model Experience

### The orchestrate:policy section

#### What the model sees

Exactly one of the two bodies above, chosen by the pending-or-logged setting, rendered right after the plan policy. Both are stable deployment-owned prose; neither varies with session data.

##### Verbatim text for this field, when needed

```markdown
Multi-task mode is ON for this session. You are the composer: for every task the user hands you,
compose a team and give the task to it — never a single agent. A team is at least two specialists
with disjoint write scopes plus the independent reviewer at the end; size it to the task, and the
smallest coherent team is the right one. When spawn_teammate is available, use named teammates
for work that needs shared tasks, peer messages, or follow-up. Use one-shot subagents for bounded
work with no continuing coordination. Give each delegation a concrete deliverable, relevant
context, disjoint write scopes, and verification requirements. Acquire file claims when available.
Check progress, unblock dependencies, and wait for required teammates before the final response.
You never grade your own team's work. When the pieces are in, hand the combined result to someone
who did not build it: `review_definition_of_done` runs a fresh reviewer against the definition of done and
returns a verdict with its reasons. Prove the contract with the countersign that review returns, or
with the receipt of a run — never with your own account of how it went. Once the team's verified
result is delivered, stand by: report it and wait for the next prompt. Do not start the next task
on your own; the next prompt gets its own team. Keep the reads that lock context in your own hand;
solving the task belongs to the team.
```

#### Token effect

Fixed: one short body per request, always present for a live agent.

#### KV Cache effect

Prefix-stable while the setting is unchanged. Toggling replaces this section's tokens in the next request; nothing else in the prompt or the tool catalog moves with it.

## Known Limitations and Deferred Work

- **Guidance, not enforcement.** ON and OFF change what the model reads; neither withholds a delegation tool, so a session set to OFF can still delegate if the model chooses to. The enforcement that does exist lives in the proof gate, not here.
- **The reviewer tool name is duplicated as a literal.** It is spelled in this package and owned by `@saturnai/dsh-review`; renaming the tool means editing both, and the reviewer package's own tests pin the name.
- **A queued toggle is invisible until it lands.** A selection made mid-turn applies at the next accepted step; a turn that never reaches one keeps the previous policy.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The [decision record](../../../.agents/notes/implemented/architecture/2026-09-15-proof-gated-done.md) explains why the ON policy stopped telling the Lead to review the combined result itself; [team per task, then stand by](../../../.agents/notes/implemented/architecture/2026-09-15-team-per-task-then-standby.md) records why the policy names a team floor and a standby, and no longer lets the Lead keep work in its own thread.

</details>
