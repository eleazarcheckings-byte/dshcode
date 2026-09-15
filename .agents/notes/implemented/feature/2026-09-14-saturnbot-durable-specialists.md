# Agent Note: Durable SaturnBot specialist execution

Status: implemented

English | [中文](2026-09-14-saturnbot-durable-specialists.zh.md)

## Problem

Autonomous business work crosses repository edits, messages, financial observations, and external publication. A dashboard that only displays generated plans cannot establish which actions ran, whether their outputs informed later decisions, or whether an approval will repeat after restart. Role conversations also need durable acceptance and a clear busy response.

## Decision

[SaturnBot](../../../../packages/saturn/saturnbot/README.md) owns a versioned, fsynced JSONL execution journal and one local cross-process writer lease. Typed planner and specialist adapters return strictly validated JSON. Specialists may continue after observing recorded tool results, within cumulative action and model-round limits. Each action is admitted using the trusted adapter's role ceiling, global permissions, and role configuration immediately before dispatch.

Developer edits occur in managed Git worktrees. Publication requires successful configured checks against the exact staged revision. Persisted approval binds that revision and the exact action and is consumed before publication. Ordinary settings cannot change during active execution or an approval wait. A deliberate boot-time YAML policy edit interrupts pending approval work. A restarted interrupted action is never automatically replayed; uncertain external effects require operator inspection.

The existing LLM service supplies models. Exact request context is committed to an auxiliary Session before provider dispatch; public output and usage or terminal errors follow. The execution journal retains plans, proposals, results, state changes, and role messages without private chain-of-thought. SQLite stores long-term memory, support tickets, and authenticated, deduplicated webhook receipts. Per-cycle reports feed a daily Markdown aggregate and a durable inbox.

The Host owns scheduler and engine disposal. Pause disables future cycles without cancelling accepted work; cancel and shutdown await active adapters. The scheduler derives its next attempt from persisted cycle time, allows one overdue catch-up, and runs only while the Host remains alive.

## Alternatives considered

Reconstructing action state only from chat messages leaves approval consumption and interrupted effects ambiguous. Treating every timeout as retryable can duplicate a sent email or publication. A single proposal for an entire task prevents a file read from informing a subsequent edit. Persisted action positions, explicit retry declarations, and bounded continuation address those cases directly.

A hosted queue or operating-system daemon would provide scheduling beyond the current Host's lifetime, but requires deployment, tenancy, and credential ownership outside this local plugin. A Git worktree isolates repository edits but does not confine the Host account; subprocess validation retains the account's filesystem and network permissions. The runtime states that limitation rather than claiming sandboxing.

## Consequences

Keyless behavior tests exercise role escalation rejection, state evaluation, bounded read/decision/action rounds, exact revision validation, single-use approvals, restart recovery, parallel branch failures, journal corruption, cache immutability, message acceptance, and awaited cancellation. Actual Host composition records LLM requests before dispatch and replays durable results; adapter tests use real Git, managed subprocesses, files, and SQLite with scripted HTTP providers. User-visible transcript projections are snapshot-tested.

The journal and provider APIs are separate durability systems. Exactly-once delivery cannot be inferred from a network response or crash, so unsafe effects are not retried. History and managed worktrees require explicit offline retention; malformed ownership locks fail closed. Separate runtime directories provide separate state and do not coordinate external accounts or repositories. Resource limits reject oversized proposals before accepting their effects and report journal exhaustion explicitly.
