# Agent Note: SaturnBot UI — Mars r1 fixes (workspace picker, unsupported field, malformed JSON)

Status: implemented

English | [中文](2026-09-15-saturnbot-ui-mars-r1-fixes.zh.md)

## Problem

Mars's first review of C8b (`.../scratchpad/review/C8b-saturnbot-ui-r1.md`) returned REVISE with three findings against `packages/client/ui-saturnbot`:

1. The wizard's workspace step had no host-native directory picker, even though `ctx.uiWorkspace.pickDirectory()` (`packages/client/ui-workspace/src/client/navigation.ts`) is exactly the injectable Cordis service AGENTS.md names as the sanctioned way to cross that boundary — the same pattern `ui-directory-picker-native` already uses.
2. `ConnectForms.tsx` rendered a live, editable text input for any catalog field key, but `safeParseIntegrations` only round-trips `endpoint` / `credentialEnv` / `resource`: a catalog entry naming any other key (e.g. a future `telegram` adapter's `chatId`) produced an input whose edits were silently discarded on every save.
3. `Configuration.tsx` passed `safeParseIntegrations(integrations)` (which degrades to `{}` on a parse failure) straight into the generated forms' `values`; the first field edit then called `setIntegrations(JSON.stringify(next))`, permanently overwriting whatever the user had actually typed into the Advanced JSON textarea.

## Decision

- **Workspace picker.** `mount.ts` now injects `uiWorkspace` alongside `remote`/`slots`/`locale` and exposes `pickDirectory: () => ctx.uiWorkspace.pickDirectory()` on `SaturnBotInjected`. Threaded as a plain callback prop `Entry.tsx` → `Dashboard.tsx` → `FirstRunWizard`. The workspace step keeps its `<select>` and freeform `<input>` as-is and adds a `Browse…` button beside the input: a resolved non-null path sets the field; a `null` (cancelled) or a rejected promise (no native chooser available, e.g. a browser-only build) leaves the manual path untouched and never throws.
- **Unsupported catalog field key.** `SaturnBotIntegrationField.key` is widened from the fixed three-value union to `string` in `contracts.ts` (SPEC §4's C8a contract puts no constraint on it; the union stays exported as `SaturnBotIntegrationFieldKey` for the keys the runtime actually admits). `ConnectForms.tsx` adds `isSupportedFieldKey` and renders a field outside that set as a disabled note (`connect.fieldUnsupported`) instead of a live input that silently drops its own edits.
- **Malformed Advanced JSON.** `ConnectForms.tsx` adds `parseIntegrationsResult`, which distinguishes a genuinely unparseable draft (bad JSON syntax, or a top-level value that is not a plain object) from a well-formed object that merely drops an unrecognized field or shape — the latter stays `safeParseIntegrations`'s existing, already-tested silent-admission behavior. `IntegrationConnectForms` gains a `disabled` prop; both `Configuration.tsx` and `Wizard.tsx` compute `parseIntegrationsResult(integrations)` once, disable every generated input and show a `connect.fixJsonFirst` notice while it is `ok: false`, and never let a generated-field edit collapse the user's malformed draft to `{}`.

## Deviations from the fix list (declared, not silent)

- **Configuration.tsx workspace field** was not given a Browse button. Mars's finding and SPEC §3 C8b's own acceptance wording ("workspace via the host directory picker") both name the **wizard's** workspace step specifically; `Configuration.tsx` is the separate advanced-configuration surface reached via "Skip to advanced configuration" / "Run the guided setup again". Adding the picker there too would be a reasonable follow-up but is outside what either the SPEC line or the fix asked for, so it was left alone to keep this round's diff scoped to the three named findings.
- **Wizard.tsx's malformed-JSON guard is presently unreachable.** The wizard's connections step never exposed a raw JSON textarea (only `Configuration.tsx` does), so `parseIntegrationsResult`/`disabled` wiring added to `Wizard.tsx` cannot actually go `ok: false` through today's UI. Applied anyway, matching Mars's fix instruction ("the same pattern in Wizard.tsx") and keeping the two call sites symmetric against a future raw-edit surface in the wizard.
- **README doc-quick gaps found while in the file, fixed as encountered:** `README.md` was missing the required `## Table of Contents` heading and `README.zh.md` was missing `## 目录` and used `### 开发说明` where the gate requires `### 开发备注` — all three pre-date this fix round (unrelated to Mars's three findings) but were mechanical one-line corrections made while touching these files for the picker/limitations-bullet updates below. Left alone: `packages/client/ui-saturnbot/README.md: must contain one or more complete model-context entries` (rewriting the Model Experience section into the repo's structured model-context-entry format is a substantially larger, unrelated documentation task, out of this round's scope) and a link-fragment-wording lint between the English/Chinese README pair (`#summary` vs `#概述`) that pre-exists the same way other packages' README pairs already carry it.

## Alternatives considered

**Make `pickDirectory` optional on `SaturnBotInjected`/`DashboardProps` instead of required**, so existing fixture-based tests would not need a stub value. Rejected: `mount.ts` always supplies a real implementation now that `uiWorkspace` is injected, so an optional signature would only invite a future caller to forget it; the mechanical prop-threading cost to the existing `dashboard.client.spec.tsx` render calls is one line each.

**Treat any `safeParseIntegrations` fallback to `{}` as the "malformed draft" signal**, rather than adding a distinct `parseIntegrationsResult`. Rejected: `safeParseIntegrations` deliberately also returns a trimmed `{}`-shaped record for well-formed JSON that merely drops an unrecognized field — an already-tested, intentional admission filter (`tests/connect-forms.client.spec.tsx`'s "drops an unrecognized field" case). Reusing that same signal to also mean "block editing" would either break that existing behavior or require re-deriving the parse in two different ways; a dedicated `ok`/`value` result type keeps both meanings distinct and each independently testable.

**Drop the unsupported field silently from the generated form** instead of rendering a disabled note. Rejected: SPEC's own connect-forms acceptance is about never silently discarding what the runtime's catalog publishes; a field that vanishes with no explanation is a worse experience than one that visibly states it is not yet supported.

## Consequences

**Cost:** one more injected Cordis service (`uiWorkspace`) and one more required prop threaded through three components (`Entry.tsx` → `Dashboard.tsx` → `Wizard.tsx`), plus a mechanical update to the seven existing `<Dashboard>` render calls in `dashboard.client.spec.tsx`. `SaturnBotIntegrationField.key` widening from a three-value union to `string` means every consumer must re-check with `isSupportedFieldKey` rather than trusting the type; `ConnectForms.tsx`'s field-rendering `.map` callback grew from a two-way ternary into an explicit three-way early-return block to keep TypeScript's control-flow narrowing valid inside the input's `onChange` closure.

**Bought:** the workspace step now reaches the same host file-system dialog every other harness workspace-picking surface uses, instead of being the one place operators had to type or paste a path by hand. A catalog field the runtime cannot yet honor is now visibly inert rather than silently eating keystrokes. A user mid-edit of a broken Advanced JSON draft can no longer lose that work to an unrelated click on a generated field — the generated forms simply refuse to touch a draft they cannot parse until it parses again.

## Testing

New: `tests/fix-round.client.spec.tsx` (10 tests: the workspace picker's three outcomes — picked path saved, cancellation, rejection; `parseIntegrationsResult`'s ok/not-ok split; the unsupported-field-key render and its disabled-while-invalid state; `Configuration`'s malformed-draft block and its re-enable once the draft parses again). `tests/dashboard.client.spec.tsx` updated to pass the now-required `pickDirectory` prop through its seven existing `<Dashboard>` render calls — a mechanical signature update, no assertion changed.

Confirmed genuine RED first: path-scoped `git stash push -- <this cell's 10 files>` reverted the implementation to the pre-fix (Mars r1) commit while leaving every sibling cell's concurrent uncommitted work untouched, then `vitest run packages/client/ui-saturnbot/tests/fix-round.client.spec.tsx` reported 9 of 10 new tests failing against that baseline (the tenth — editing an already-supported field — passes in both states, as expected for a regression guard rather than a new-behavior test). `git stash pop` restored the fix implementation; full package suite then green.

Commands and verbatim output are in the fuller report at `report_path`.

## Deferred

A picker on `Configuration.tsx`'s own workspace field, and resolving `Wizard.tsx`'s currently-unreachable malformed-JSON branch once (or if) the wizard grows a raw JSON surface, are both one small step past this round's three named findings; see Deviations above. The pre-existing README `model-context entries` gap (see Deviations) is likewise left for a documentation-focused pass.
