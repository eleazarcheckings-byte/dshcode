# Agent Note: Provider choice during first-run setup

Status: implemented

English | [中文](2026-09-15-onboarding-provider-choice.zh.md)

## Problem

A required DeepSeek credential prevents users of another provider from reaching Models. Completing setup also cannot establish that an untested provider is authenticated.

## Decision

[First Light](../../../../packages/client/ui-settings-models/src/client/FirstLight.tsx) offers DeepSeek verification or an explicit choice to configure another provider after the remaining setup steps. The deferred receipt names unfinished model setup. Only a successful profile, voice, agent-memory, and completion write transfers to Models; a failed write retains the answers and retry action. Another provider's configured state cannot authorize an automatic DeepSeek probe, and a late probe response cannot replace the deferred receipt with a connected claim.

The later [DeepSeek prompt](../../../../packages/client/ui-settings-models/src/client/DeepSeekOnboardingDialog.tsx) also offers an explicit Models action. Both actions complete their coordinator step before opening Models. [SettingsRoot](../../../../packages/client/ui-settings-general/src/client/SettingsRoot.tsx) suspends pending onboarding while Settings is open, releasing the onboarding modal's focus and inert ownership. Closing Settings resumes the next pending step.

Provider choice changes navigation only. It writes no credential, provider configuration, or readiness flag. The existing Models page remains responsible for provider configuration. A completed First Light setup does not reopen Models on a later mount.

Settings wraps Tab and Shift+Tab at its first and last available controls. The handler excludes disabled, hidden, and non-tabbable controls and leaves events originating in nested dialogs to their owner. It does not make the application root inert because the settings panel lives inside that root. First Light action rows wrap on narrow screens.

## Alternatives considered

**Require DeepSeek before other providers.** This makes a second provider's credential a prerequisite for users who do not intend to use it.

**Mark the model ready when setup is skipped.** This confuses a navigation decision with provider evidence and misleads users about whether requests can run.

**Open Models under the pending onboarding dialog.** The modal retains focus and inert ownership, leaving the destination inaccessible. The settings shell owns this transition because feature dialogs cannot coordinate the next registered step themselves.

## Consequences

Users can finish personal setup before configuring a model, so completion alone does not promise that chat can run. The explicit action remains available after failed or pending discovery. Deferral is not a stored provider preference; if a later coordinator pass still lacks a usable provider, its prompt can offer the same choice again.

## Verification

The [First Light tests](../../../../packages/client/ui-settings-models/tests/first-light.client.spec.tsx) cover English and Chinese keyless setup, the rendered deferred receipt, successful and refused completion writes, unchanged provider state, a late discovery response, another configured provider, and the existing DeepSeek key-save path. The [credential prompt tests](../../../../packages/client/ui-settings-models/tests/onboarding-dialog.client.spec.tsx) cover explicit navigation without credential writes. The [settings-shell tests](../../../../packages/client/ui-settings-general/tests/settings-root.client.spec.tsx) exercise real modal inert cleanup and resumption after Settings closes.
