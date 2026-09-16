# Agent Note: Saturn Team policy and file ownership

Status: implemented

English | [中文](2026-09-14-saturn-team-file-ownership.zh.md)

## Problem

Team tool guidance requires an explicit user request. The built-in presets also contribute legacy controls with names owned by Team tools. File claims deny overlapping acquisition, and a first mutating write auto-takes a lease so an unclaimed path does not stay open.

## Decision

Team guidance follows the session multi-task policy. It prefers named teammates for ongoing shared work and one-shot subagents for bounded independent tasks. The standard, cordis, and ptc presets use Loader expressions to omit legacy messaging controls and select one-shot background jobs when the host provides `agentTeams`; hosts without Teams retain their existing continuable subagent behavior.

The claims plugin wraps first-party file mutations on `tools/execute`, after which the filesystem's existing observation, approval and sandbox policies still run. It compares canonical provider targets against peer-owned scopes and holds the cross-process ledger transaction through dispatch. Only the owning session may release or rebase a claim. A first mutating write of an unclaimed path auto-takes a lease for the acting session; a peer's live claim is denied.

## Alternatives considered

Prompt-only coordination cannot prevent an accidental overwrite. A check on the filesystem intent events cannot occupy the single decision slot already owned by stale-version policy, and a check before dispatch without holding the transaction leaves an acquisition race. Parsing arbitrary shell commands would claim protection the runtime cannot provide reliably.

## Consequences

First-party writes serialize within one workspace, including independent files. This favors predictable ownership over maximizing small-file write throughput. Shell tools, formatters, code generators and external editors still require coordination. Linked git worktrees of one repository share one ledger. External symlink changes during dispatch remain outside the ownership protocol.

Focused tests exercise peer release/rebase denial, every first-party mutation, owner writes, reads, independent work, expiry, alias resolution and a competing acquisition during a write. A test-only Cordis composition runs the real agent loop and snapshots the logged denied tool result together with the unchanged file. Preset tests evaluate the shipped YAML with and without the Team service. These tests use no model credentials.
