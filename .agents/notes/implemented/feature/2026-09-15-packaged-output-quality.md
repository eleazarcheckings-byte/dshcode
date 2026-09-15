# Agent Note: Packaged output quality for Saturn AI agents

Status: implemented

English | [中文](2026-09-15-packaged-output-quality.zh.md)

## Problem

A polished harness interface does not give its agents the workflow needed to create polished user deliverables. Local user instructions and an onboarding endpoint probe do not establish a shared design process for every deployment or selected agent preset. Visual quality also cannot be inferred from a successful build or a model's own completion claim.

Generating an entire deliverable in one response can exhaust the response limit before any file write executes. A completed write proposal in a response that later truncates is still discarded by the existing tool-call protection, so detailed planning alone leaves no usable artifact.

## Decision

[skill-premium-output](../../../../packages/skill/skill-premium-output/README.md) contributes a short shared policy through `systemPrompt.section` and immutable guides through the existing skill registry. The `dsh-base` composition owns the mount, so its ordinary profiles share the guidance. The plugin does not modify the loop, route the model, or grant tools. The existing request header records the policy, and the existing skill tool records loaded instructions. Complete personas retain their exact-prompt semantics.

The three guides cover websites, purposeful motion, and general deliverables. Packaged helpers make concrete rendering and review techniques available without installing them into user-owned directories or launching them automatically. Project and user skills override packaged names through normal skill precedence; user instructions govern scope and branding.

The policy and guides direct substantial work through a saved, usable first version followed by completed increments and relevant checks. This keeps an executed result available if later refinement is interrupted. Targeted edits preserve existing behavior, and the initial version remains intermediate work toward the full brief. The guidance does not enforce a token reserve, change selected reasoning effort, or execute truncated tool calls.

## Alternatives considered

**Rely on a private global instruction file or external Design brain probe.** These do not establish deployment-wide instructions or guarantee that an agent can access the probed tools. The bundled provider remains available without network access.

**Insert every guide into every request.** This adds irrelevant context to small tasks. The shared policy remains concise while full guides load through the existing progressive-disclosure mechanism.

**Force a stronger model or a mandatory critique round.** These change user cost and latency without proving visual quality. The selected model and execution budget remain authoritative; agents use critique when it advances the actual task.

**Increase the response limit or execute completed calls from a truncated response.** A larger limit does not require the model to finish a write. Executing a partial group of intended edits can leave inconsistent files. Small completed steps retain useful work without weakening truncation protection.

**Treat screenshots or passing builds as automatic quality scores.** Such checks establish observable facts, not aesthetic judgment or complete interaction coverage. The guidance separates rendering, inspection, behavior checks, and truthful reporting.

## Consequences

Ordinary agents receive consistent output expectations and reusable techniques across model routes. A dedicated Loader fixture uses a scripted model, real skill and file execution, and durable session logs in native and PTC modes. It verifies that a saved artifact remains intact after a later truncated refinement, whose complete and partial tool proposals never execute. Unit tests cover disposal, config, override precedence, hidden tools, resource paths, and complete personas. These tests establish delivery of the workflow and retention of completed writes, not model compliance or generated design quality.

The explicit minimal profile and complete custom personas can omit the policy. Browser review still needs available tooling, and missing dependencies must be reported rather than converted to a passing result. No provider credentials are required for the packaged guides or keyless tests.
