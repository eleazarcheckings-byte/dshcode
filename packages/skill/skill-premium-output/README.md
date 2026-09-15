---
description: "Packaged output-design guidance for Saturn AI agents: shared policy, website and motion workflows, artifact review, and deployment overrides."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-premium-output

English | [中文](README.zh.md)

## Summary

This plugin supplies a shared output-quality policy and three packaged skills through the existing prompt and skill registries. Base-backed profiles enable it by default, so ordinary standard, PTC, Cordis, and custom agents receive the same expectations without depending on a user's private instruction files or an external Design brain connection. The policy asks agents to establish a coherent direction, save a usable first version, refine it in completed increments, inspect rendered output, and distinguish completed checks from unverified work.

## Table of Contents

- [Use this package](#use-this-package)
- [Configuration and scope](#configuration-and-scope)
- [Packaged resources](#packaged-resources)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The `skill-premium-output` row in [dsh-base](../../bundle/base/cordis.patch.yml) mounts the provider and policy for `web` (including desktop), `headless`, `sdk`, and `acp`. Removing or disabling the row removes both contributions. The separate `sdk-minimal` bundle does not include this plugin.

The plugin requires `skills` and `systemPrompt`. When an agent can resolve the `skill` tool, the policy directs it to load a matching guide. The existing skill consumer publishes the available catalog and logs the complete loaded instructions in a tool result. Without the tool, the concise shared policy remains useful and does not instruct the agent to call it.

## Configuration and scope

`enabled` defaults to `true`; setting it to `false` disables both contributions. `policy` replaces the shared policy text and must be a nonempty string. A deployment can override these fields through its profile patch; a patch replaces the row's complete config.

```yaml
- id: skill-premium-output
  config:
    enabled: true
    policy: Preserve the client's design system. Inspect rendered work and report the checks actually completed.
```

Packaged skills use rank `600`. Existing project and user skills with the same names override them through the registry's normal precedence, including preset-scoped providers. User requests and project conventions govern the artifact's branding; this plugin does not apply Saturn's own palette to customer work. Complete personas suppress the policy through the prompt registry's existing complete-prompt behavior. The plugin does not change model selection, permissions, delegation limits, or execution budgets.

## Packaged resources

- [premium-web-experience](skills/premium-web-experience/SKILL.md) covers website direction, content, interactions, responsive states, and browser inspection. Its [browser review helper](skills/premium-web-experience/scripts/review-web.mjs) captures observable checks; a report is not an aesthetic score.
- [purposeful-motion](skills/purposeful-motion/SKILL.md) covers animation composition, state communication, restrained ambience, reduced motion, and rendering lifecycle. Its [canvas runtime recipe](skills/purposeful-motion/recipes/canvas-runtime.mjs) is a reusable starting point.
- [premium-deliverables](skills/premium-deliverables/SKILL.md) covers documents, presentations, data, and other finished artifacts using the appropriate rendered or executable checks.

Each guide returns its own absolute resource directory. Relative helper paths resolve against that directory in source and installed packages. Reading a guide never launches its scripts, installs a browser, contacts a provider, or creates files in the user's home. Read failures propagate through the skill registry's normal unavailable-skill handling.

## Model Experience

### Shared quality policy and progressive guide loading

#### What the model sees

The `saturn:output-quality` system-prompt section contains the [shared policy](src/policy.ts). Agents with a visible `skill` tool also receive routing instructions for the three guides. The skill catalog contains only summaries; the tool result carries the selected complete Markdown body and its resource directory.

#### Token effect

The shared policy adds a fixed prompt contribution; optional tool guidance adds one paragraph. Guide bodies enter context only after loading. Helpers and recipes are not injected unless an agent reads them.

#### KV Cache effect

The section is stable for an unchanged policy and tool view. The existing `request/header` event records the assembled system text, and existing skill catalog and tool-result events record guide disclosure. No request-only mutation or new event type is introduced.

## Known Limitations and Deferred Work

These workflows improve the instructions agents receive; they do not guarantee model compliance, aesthetic quality, or a production-ready result. Early-save guidance does not enforce a token reserve or change reasoning effort. Models remain responsible for choosing relevant guides and acting on their checks. No extra model critique or paid-provider call runs automatically.

Browser inspection requires browser tooling available to the agent. The bundled helper requires its documented local runtime dependencies; unavailable dependencies remain a named review gap. A passing build, screenshot file, or automated report alone does not prove visual quality. Complete custom personas and the minimal preset can intentionally omit the guidance.

The Windows workspace-write sandbox currently blocks the piped child-process launch Playwright requires, even with Chromium installed ([sandbox limitation](../../sandbox/sandbox-windows-acl/README.md#known-limitations-and-deferred-work)). The helper reports a Windows `spawn EPERM` launch denial as unavailable with no screenshots, and directs callers to an authorized browser integration or operator-supported execution that preserves shell policy. It does not automatically disable sandboxing. Other Windows restrictions can produce the same error, so the diagnostic does not claim its exact cause.

## Dev Note

The [decision record](../../../.agents/notes/implemented/feature/2026-09-15-packaged-output-quality.md) explains shared deployment ownership and limits. Unit tests cover config, disposal, precedence, tool visibility, resource paths, and complete-prompt behavior. A real Loader fixture runs a scripted model through the shipped Headless profile in native and PTC modes. It checks durable policy and guide output, and proves that a completed file write survives a later truncated refinement whose tool calls never execute. It does not evaluate generated designs or model compliance.

**Runtime invariant:** No companion is published. This plugin owns immutable packaged content and effect-owned registrations, with no independently mutable projection to reconcile.
