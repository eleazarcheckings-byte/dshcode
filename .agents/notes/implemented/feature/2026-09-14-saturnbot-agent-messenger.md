# Agent Note: SaturnBot operates through an independent agent messenger

Status: implemented

English | [中文](2026-09-14-saturnbot-agent-messenger.zh.md)

## Problem

SaturnBot needs a clear management surface for persistent specialist conversations, scheduled work, exact approvals, and durable outcomes. Replacing the main harness or presenting synthetic dashboard statistics would obscure the real execution model.

## Decision

Add `ui-saturnbot` as a shell-overlay Client plugin. The main harness contributes a modest top-right launcher; its named same-origin window contains a three-column roster, role conversation, and execution inspector. The covered harness is inert. The Host and desktop packages own Remote methods and native popup admission.

Use the generated Remote through a private React-free snapshot controller and injected slot hooks. Serialize commands and refreshes, deduplicate baseline requests, retain drafts on failure, ignore late disposed results, and separate command admission from trace-read failure. Load the latest 1,000 journal records in at most five pages so reopening an old instance shows current activity. Poll only visible active work, with a one-shot wake at an enabled schedule boundary.

Display only recorded branches, messages, tool input/output, approval decisions, stage revisions, reports, memory, tickets, webhooks, and connection configuration. Explicit setup and specialist settings write validated Host configuration. The topology canvas moves only when corresponding branches run; static status text, reduced motion, visibility suspension, capped density/frame rate, and cleanup remain mandatory.

## Alternatives considered

**Generic metric dashboard.** It does not fit the user-provided agent messenger reference and would duplicate execution information without helping operators act.

**A modal inside the main conversation.** The user explicitly requested a separate management window; a modal also competes with the resident composer.

**Independent polling inside components.** This permits overlapping requests, stale projections, and resource leaks. The controller owns the single observable projection and all transport timing.

## Consequences

The application exposes a premium agent-centric operating surface while preserving existing slot composition. It manages one workspace instance, not multi-tenant service accounts. The UI labels bounded recent trace history and unconfigured connections honestly. Local drafts survive failed commands but not window closure. English and Simplified Chinese copy remain package-owned.

## Verification

Focused tests cover role-local drafts, successful and failed sends, busy admission, exact approval payloads, newest-first briefings, real memory records, serialized and deduplicated transport, five-page historical catchup, background scheduling and disposal, launcher/inert/title behavior, canvas lifecycle, and a selected-agent timeline snapshot. Client TypeScript and scoped lint pass; the global UI i18n gate has unrelated existing findings but none in this package. The assembled application supplies the final browser/native smoke check.
