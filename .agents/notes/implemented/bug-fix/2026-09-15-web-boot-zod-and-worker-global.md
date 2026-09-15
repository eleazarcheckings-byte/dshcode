# Agent Note: Shipped web boot depends on the design-brain zod declaration and the worker global alias

Status: implemented

English | [中文](2026-09-15-web-boot-zod-and-worker-global.zh.md)

## Problem

The design-brain host plugin's generated remote (`lib/typert.remote-client.js`) imports zod, but the package manifest never declared it, so pnpm materialized nothing beside the package and tsdown left `require("zod")` external in the ui-settings-models client bundle. The loader module table cannot answer a bare zod specifier, so every scaffolded web boot failed with "Failed to load plugins". In the packed preview worker the same tree failed earlier: design-brain's mcp-client chain evaluates cross-spawn/which/isexe at import, and those read the Node `global` object the worker never installed.

## Decision

design-brain declares zod `^4.4.3` in `dependencies` — the same declaration every other saturn package with a generated remote carries — so client bundlers resolve and inline it. The webworker runtime installs the Node-style `global` alias (identity with `globalThis`) beside its process, timer, crypto, and Buffer globals, so unchanged Node-compatible packages that read `global` at module evaluation load instead of throwing before the tree activates. The preview lane keeps exercising the shipped onboarding: the showcase fixture seeds a completed First Light and an acknowledged welcome notice, the shipped provider prompt is deferred through its real button, and the Models panel that deferral opens is closed.

## Alternatives considered

**Shim `global` without declaring zod.** Only half of the failure: the browser bundle would still require a specifier the loader cannot answer.

**Exclude design-brain from the preview composition.** The preview's contract is to boot the real shipped tree; composition exclusions hide drift instead of loading the tree.

**Walk the whole First Light sequence in the preview lane.** Onboarding UX has dedicated lanes against the real host; the preview lane owns worker boot and the showcase, so the fixture seeds a finished setup instead.

## Consequences

A fresh install and build boots both the served app and the packed worker. Any future package whose generated remote imports zod must declare it the same way; the pattern is the saturn packages' existing one.

## Verification

The onboarding-deepseek-config, onboarding-usable-provider, ambient-canvas, saturnbot, agent-team-panel, and preview-boot web lanes pass in keyless replay; the onboarding goldens were refreshed to the rebranded welcome copy, the provider-choice dialog, and the Design brain footer card. The webworker runtime's global-alias spec pins the alias identity, and the vfs-example fixture spec pins the seeded settings.yaml byte for byte.

## Model experience

No model-visible content changes. The fix restores plugin loading and the worker compatibility layer.
