---
description: "Restart-durable, workspace-bound scheduled tasks: the schedule_durable_create, schedule_durable_list, schedule_durable_pause, schedule_durable_resume, and schedule_durable_cancel tools, for users and maintainers choosing, configuring, or debugging the package."
kind: "package-reference"
---

# @deepseek-ai/dsh-schedule-durable

English | [中文](README.zh.md)

## Summary

`dsh-schedule-durable` gives a deployment scheduled tasks that survive a harness restart: cron and one-shot forms, a task bound to the absolute workspace it was created in, pause, resume, and cancel, all persisted through the `dsh-storage-domain` seam rather than the session log. It composes beside the session-scoped `@deepseek-ai/dsh-schedule` package rather than replacing it — that package delivers a reminder back into one live conversation and stops mattering once the session ends; this package's tasks are not tied to any session or live Agent at all, so a task keeps firing on schedule across a cold start. A task that missed one or more occurrences while the process was down fires exactly once on the next reconciliation pass and re-arms itself from the current instant, never replaying a backlog. What a firing actually does is delegated to a pluggable dispatcher a deployment composes separately; without one, a firing is recorded and takes no further action, so the package is safe to mount on its own. See [Model Experience](#model-experience) for the exact tool contracts and [Known Limitations and Deferred Work](#known-limitations-and-deferred-work) for the dispatcher seam and why this package does not itself start an agent session.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use Schedule-Durable when a task must keep firing whether or not any session is open — for example a nightly build, an hourly health check, or a one-off task due tomorrow that should still run if nobody is at the keyboard when it comes due. Choose the session-scoped `@deepseek-ai/dsh-schedule` package instead when the goal is a reminder delivered back into the current conversation; choose SaturnBot instead when the goal is a standing business-automation loop with its own planner, roles, and channel adapters — this package only decides when a task is due and hands the firing to whatever dispatcher a deployment configures.

### Mount the plugin

The plugin requires `tools` and `storageDomain` (mount a storage backend and `@deepseek-ai/dsh-storage-domain` first), and takes one optional config field:

```yaml
- id: schedule-durable
  name: '@deepseek-ai/dsh-schedule-durable'
  config:
    pollIntervalMs: 30000
```

`pollIntervalMs` controls only the live process's poll cadence; restart catch-up does not depend on it — the first reconciliation pass runs immediately on mount, before the interval ever fires.

### Create, list, pause, resume, cancel

`schedule_durable_create` takes a non-empty `name` and `prompt`, an absolute `workspace` path, and exactly one of `cron` (a standard 5-field `minute hour day-of-month month day-of-week` expression, interpreted in UTC) or `at` (a four-digit-year RFC 3339 UTC instant strictly in the future). A successful create returns the task's full durable view, including its computed `nextFireAt`. `schedule_durable_list` returns every task in the store. `schedule_durable_pause` and `schedule_durable_resume` take a task `id`; pausing an already-paused task and resuming an already-active task are no-ops that return the current view rather than an error, and resuming recomputes the next fire strictly after the current instant rather than replaying whatever the task missed while paused. `schedule_durable_cancel` durably removes a task by id and is idempotent: cancelling an already-cancelled or unknown id reports `cancelled: false` with `task_not_found` rather than throwing.

Input that cannot become a task — an empty name or prompt, a non-absolute workspace, neither or both of `cron`/`at`, a syntactically invalid cron expression, a cron rule that can never produce a future firing, a malformed `at` string, or an `at` instant that is not strictly future — returns a stable error code instead of succeeding; the closed error union is defined in [`src/types.ts`](src/types.ts).

### How firing works

A task fires when its `nextFireAt` is due at the instant a reconciliation pass runs; a pass runs once immediately on mount and again on every `pollIntervalMs` tick. Firing is exactly-once per pass by construction: a due task computes its next occurrence strictly after the reconciliation instant, not by walking forward from the missed occurrence, so however many occurrences a cron task missed while the process was down, one pass fires it once and re-arms it at the correct future target. A one-shot task instead moves to `done` and stops. What happens on a firing is delegated to a dispatcher resolved duck-typed from `ctx.get('scheduleDurableDispatcher')`; a deployment that does not configure one still composes — the firing is recorded and no further action is taken. See [Known Limitations and Deferred Work](#known-limitations-and-deferred-work) for why wiring a real dispatcher (for example one that starts an agent session) is a deployment-level integration decision this package does not make on its own.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the plugin and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `inject`, tool registration, the reconciliation engine, and the default recording dispatcher |
| [`src/store.ts`](src/store.ts) | The `schedule_durable` storage-domain spec, its zod record schema, and a typed CRUD wrapper |
| [`src/cron.ts`](src/cron.ts) | Self-contained 5-field cron parsing and UTC next-fire search (no external cron dependency) |
| [`src/types.ts`](src/types.ts) | Durable and model-facing value types; no runtime code |

### Persistence, not the session log

Every durable field lives in one `schedule_durable` domain with one `tasks` table, opened through `ctx.storageDomain` (the `dsh-storage-domain` form over whichever backend a deployment routes it to, typically `dsh-storage-json` or `dsh-storage-sqlite`). Every stored record is validated against its zod schema both when the domain opens and on every write; a record that fails validation makes the whole domain open fail loud with `invalid-record` rather than silently dropping the one bad task. This package declares no `SessionEventMap` member and reads no session state: a task's lifetime is the store's lifetime, not any one session's.

### The reconciliation engine is a pure function of a clock

`reconcileTask(task, nowMs)` in `src/index.ts` is a pure, synchronous function: given a task and a wall-clock instant, it returns the task's next durable state and, when this instant crosses `nextFireAt`, a dispatch instruction — nothing here reads `Date.now()` internally. `ScheduleDurableRuntime.reconcileAll(nowMs)` is the only place that supplies the live clock by default, and every test instead supplies an explicit instant, which is what lets the exactly-once-catch-up behavior be asserted deterministically rather than by racing a real timer. `resumeNextFireAt` applies the identical "strictly after now" rule when a paused task returns to `active`, so resuming a task never replays the interval it was paused for.

### The dispatch seam

`TaskDispatcher` (`src/types.ts`) is the one seam between "this task is due" and "something happens." `ScheduleDurableRuntime` resolves it duck-typed via `ctx.get('scheduleDurableDispatcher')`, exactly like the model-router seam `ctx.get('modelRouter')` documented in `@saturnai/dsh-model-router`: an optional service a deployment provides, never declared as a hard `inject` dependency. Without one, `recordingDispatcher` logs the firing through `ctx.logger` and returns `{ kind: 'dispatched', detail: 'no scheduleDurableDispatcher configured; no action was taken' }` — a real value, not a silent no-op, so a deployment can tell from the tool's own output whether a dispatcher is wired.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Durable task management tools

#### What the model sees

The model sees five schemas once this plugin loads: `schedule_durable_create`, `schedule_durable_list`, `schedule_durable_pause`, `schedule_durable_resume`, and `schedule_durable_cancel`, registered globally rather than scoped to any one Agent or Session. Each tool's exact parameter and result schema is defined in [`src/index.ts`](src/index.ts); results are the canonical JSON values described above under Use this package.

#### Token effect

The five schemas add a fixed request prefix while the plugin is mounted. Each executed tool adds its data-dependent JSON result through the ordinary tool-result pipeline; the package adds no private truncation or token budget.

#### KV Cache effect

The five schemas remain prefix-stable while the plugin stays mounted with unchanged configuration. Tool calls and results append to later history and preserve an already reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits describe when Schedule-Durable does not fit your use case or needs special operational care. They are current package constraints, not a task backlog.

- **No default action on firing** — this package decides when a task is due and fires it exactly once; it does not itself start an agent session, send a message, or run a command. Without a `scheduleDurableDispatcher` configured on `ctx`, a firing is recorded and nothing else happens. Composing a dispatcher that starts a real agent session against `ctx.subagents` needs a live spawning Agent (its docs state that in-process providers derive workspace and lineage from the spawning Agent's own durable session state), which a headless restart-time reconciliation pass does not have; wiring a cold-start-safe session bootstrap is a deployment-level integration this package's exclusive write scope does not include.
- **Host must be running** — reconciliation only happens while the harness process is up; there is no cloud runner, and a task due while the machine is off or asleep fires on the next reconciliation pass after the process resumes, not at its original instant.
- **UTC only** — both `cron` and `at` are interpreted in UTC with no local-time-zone or daylight-saving support; a caller wanting a local wall-clock schedule must convert to UTC before calling `schedule_durable_create`.
- **One dispatcher, not a fan-out** — `ctx.get('scheduleDurableDispatcher')` resolves at most one dispatcher; a deployment wanting different actions per task composes that routing inside its own dispatcher implementation, not inside this package.
- **No missed-run history** — a task's durable state carries only `lastFiredAt`, its most recent firing; the package keeps no log of every past occurrence or of occurrences skipped during catch-up.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Note.

A cold-start-safe agent-session dispatcher (one that can start a fresh top-level session with no live parent Agent, for the `ctx.subagents` seam to spawn from) is the natural next integration once a deployment decides it wants tasks to take action rather than only fire; no such bootstrap currently exists in the harness outside a live Agent context, and building one is out of this package's exclusive write scope. Neither a bundle row nor a preset row is wired for this plugin yet; see the Agent Note's integration needs.

</details>
