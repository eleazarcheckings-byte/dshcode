# Agent Note: SaturnBot role-specific delivery criteria

Status: implemented

English | [中文](2026-09-15-saturnbot-output-quality.zh.md)

## Problem

SaturnBot uses direct, durably logged LLM calls. The premium-output guidance mounted in ordinary chat sessions therefore does not reach its planner and specialists.

## Decision

Each bot request includes a concise `outputQuality` array selected by the runtime-owned role.

The planner favors concrete outcomes and acceptance criteria. Development covers incremental staged delivery, relevant interface states, purposeful motion, and observed validation. Growth distinguishes drafts, accepted generation requests, completed assets, and measured campaign results. Operations grounds replies and escalation in customer context. Finance preserves source, period, currency, units, and incomplete-data qualifications.

## Alternatives considered

**Reuse the ordinary session guide implicitly.** Direct bot calls do not traverse that session composition. Assuming inheritance leaves the bot without the delivery criteria.

**Give every specialist the same design guide.** Website-specific requirements do not fit financial reports or support replies. Role-owned criteria preserve their distinct responsibilities and evidence requirements.

## Consequences

These delivery instructions add prompt tokens without adding capabilities or an approval mechanism. Role tool bindings and exact-action approval remain in the engine. The guide requires browser inspection only when such tools exist and requires missing evidence to be reported. The bot does not gain the reference-service connection through this change.

## Testing

Keyless specialist snapshots pin each role's criteria. The real Loader composition test verifies that planner and operations criteria reach the provider unchanged after being durably recorded. Scripted provider responses establish transport and persistence behavior, not model compliance or aesthetic quality. No model/version/effort selection changes.
