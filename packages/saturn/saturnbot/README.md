# SaturnBot runtime

English | [中文](README.zh.md)

SaturnBot runs persistent business tasks through a planner and four specialists. The authenticated dashboard exposes role conversations, execution history, exact-action approvals, reports, and local memory. The Host plugin composes the existing LLM, Session persistence, managed subprocess, and optional web-server services; launch it through a configured `dsh` profile.

## Configuration

The first boot creates a disabled `config.yaml` with the registered tools and their permitted roles. Set an absolute workspace, a business goal, and an available LLM provider/model before enabling scheduling. [config.example.yaml](config.example.yaml) lists the runtime settings. Provider names identify providers registered in the existing harness; they do not install a provider or supply its credentials. The default selection is `deepseek-official` / `deepseek-v4-flash`.

Each role has `enabled`, `instructions`, and an exact `tools` list. Both its list and global `allowedTools` must permit an action, and neither can exceed the trusted adapter's declared roles. The orchestrator evaluates current repository, memory, inbox, ticket, webhook, and financial feeds that its policy permits. Developer, growth, operations, and finance then receive independent tasks within their respective permissions. Missing connections appear as explicit feed failures or task blockers. Credential presence is shown as `configured`; it does not assert successful authentication.

Configuration uses version 1 YAML with strict Zod validation. Unknown fields, executable/custom tags, aliases, relative workspace paths, and oversized documents fail explicitly. Integration credentials use `credentialEnv` variable names; supply values to the launching process. [Adapter reference](ADAPTERS.md) owns provider setup, exact HTTP requests, the HMAC-signed `/saturnbot/webhook` route, and tool-specific limits.

The Host's `dataDirectory` defaults to the harness home directory's `saturnbot` child. `configFile` can select another absolute YAML path. Dashboard configuration atomically writes YAML before appending its journal transition. On boot, deliberate YAML edits are imported and recorded; edits that change pending execution policy interrupt its approvals. Ordinary configuration changes require the current cycle to finish or be cancelled. Pause changes only scheduling and can be saved during active work.

## Execution and approval

`runNow()` accepts one background cycle after recording its identity. `message(role, content)` records a 1–8000-character instruction and starts that role's task without changing the standing goal. A busy runtime rejects the request before storing the message so the composer can retain its draft. The orchestrator may choose zero tasks when no useful work is available, or up to `maxTasks` independent tasks, capped at three.

Specialists return schema-checked proposals. A proposal may use `continue: true` to observe completed tool results before making another decision. The complete branch shares one `maxActionsPerTask` budget; model rounds are capped at that budget plus one, and empty continuation is rejected. Accepted actions and their completed position are journaled. Resuming an approval continues the saved branch and never repeats earlier effects.

PRs, deployment, and general/social publication require approval by default; email submission requires approval unless `autoDispatchEmail` is enabled. An approval binds the exact tool, arguments, action position, and staged revision and is consumed durably before dispatch. Approval authorizes that single action. Rejecting it interrupts that branch. Developer publication additionally requires a managed stage and successful configured validation commands for its exact revision; a subsequent edit clears validation. Adapter definitions fix effect classification, role ceilings, and retry semantics independently of model output.

Safe or explicitly idempotent operations receive at most two attempts. An uncertain send, publication, or staged write receives no automatic retry. A failed branch records an alert and redacted error stack while other branches finish. Restart marks interrupted work without replaying its last effect. The operator can inspect the final tool-start and create fresh work after resolving an uncertain outcome.

## Scheduling and lifecycle

Scheduling defaults to disabled and a 30-minute interval. Enabling requires both goal and workspace. The scheduler uses the latest cycle's start time, allows at most one overdue catch-up, and waits while a cycle or approval remains active. `pause()` durably disables future scheduled cycles; `cancel()` aborts active work and rejects pending approvals. Cancellation and Host disposal await adapter and process-tree settlement.

The Host process must remain running, including the native application's supported background/tray mode when available. This package does not install an operating-system service, wake a sleeping machine, or execute while the Host is stopped. The execution lease excludes concurrent writers using the same local data directory; separate directories create independent runtimes and do not coordinate work against the same external account or repository.

## Persistence and limits

`events.jsonl` is the fsynced source of execution state. Cached parsing and incremental projections avoid repeatedly replaying the entire log during dashboard polling. Readers receive detached snapshots. A crash-partial final line is ignored and trimmed under the writer lease; invalid complete records fail closed. SQLite separately owns memory, tickets, and deduplicated webhook receipts. The JSONL journal and external services are not a distributed transaction.

Every model request is recorded in a durable auxiliary Session before provider dispatch; corresponding structured output, usage, or terminal error is recorded afterwards. Exact model-visible context remains reconstructable. The execution journal records public plans, proposals, tool inputs/results, approvals, and state changes; private chain-of-thought is excluded. Credentials are redacted from retained tool facts, but messages and business documents remain sensitive application data.

Cycle reports and a daily aggregate are delivered to the durable report inbox. Full daily Markdown is written to `reports/YYYY-MM-DD.md`; the dashboard digest is a bounded preview. `reportChannel: inbox` is the supported destination. Another channel name produces an explicit alert and retains the report in the inbox; it does not send externally.

The dashboard retains the latest 50 cycles, 200 approvals, 100 reports/alerts, and 200 chronological messages; cursor-based events expose the retained journal. Configuration is capped at 128 KB, cumulative accepted cycle proposals at 1 MiB, and individual journal records at 2 MiB. Input/output byte limits and model token limits are configurable. The journal defaults to 64 MiB, configurable through the Host's `maxJournalBytes`; execution checks headroom before further effects and fails explicitly near the cap. There is no automatic journal compaction, worktree pruning, or retention service. Stop the Host and preserve the complete data directory before moving archived history to a separate directory or choosing a new runtime directory.

Only a provably dead process owner permits automatic lease recovery. An unreadable `execution.lock`, or a stale `execution.lock.recovery` left by a crash during recovery, requires operator inspection with all writers stopped. Never remove a live writer's lock. The [adapter isolation limitations](ADAPTERS.md#local-tools-and-isolation) apply to all validation and publication paths.

## Model Experience and extension points

Each direct model request includes `outputQuality` criteria for its role: outcome and acceptance criteria for the planner, usable staged artifacts and interface checks for development, factual copy and confirmed creative results for growth, context-aware replies for operations, and source/period/currency/coverage for finance. This concise role-specific context is recorded before dispatch and remains subject to the configured input limit. It does not add tools, bypass approvals, attach the reference service, or prove model compliance. The bot does not inherit ordinary chat-session skills automatically.

`BotModel`, `BotAgent`, `BotOrchestrator`, `BotTool`, `BotExecutionState`, and `BotScheduler` describe the replaceable implementations in [contracts.ts](src/contracts.ts). Tool schemas are supplied with role-visible model context; successful branch results and the remaining budget accompany follow-up proposals. Adapters must honor cancellation and await their owned resources before returning. No `./invariant` installer is exported: this package owns one journal projection and checks lease ownership, role admission, approval identity, and revision matching at their executing operations.

The [implemented decision](../../../.agents/notes/implemented/feature/2026-09-14-saturnbot-durable-specialists.md) records the persistence and publication tradeoffs. Focused tests under [tests](tests) exercise restart recovery, actual local adapters, Host composition, cancellation, role restrictions, and durable model requests without paid credentials.
