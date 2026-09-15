/**
 * Real-environment coverage for Mars r2 F1-r2 (`.../scratchpad/review/C6-model-router-providers-r2.md`):
 * the green suite in `harness-cli-resolution.spec.ts` injects a fake two-stage
 * resolver whose `resolve()` treats every specifier alike, so it cannot see a
 * defect that only shows up against real, differently-shaped manifests. No
 * fakes here: this uses the real `node:module` `createRequire` against the
 * platform CLI packages actually installed under each wrapper's own
 * `node_modules` directory (see `packages/subagent/subagent-codex` and
 * `packages/subagent/subagent-claude-code`).
 *
 * The two harnesses need OPPOSITE specifier forms to resolve their CLI
 * dependency, which is exactly what `harnessCliResolvable` must try both of:
 *
 * - `@openai/codex` (`dsh-subagent-codex`'s CLI dependency) has no `main` and
 *   no `exports` field — only a `bin` entry. The bare specifier throws
 *   `MODULE_NOT_FOUND` (there is nothing for Node to load as the package's
 *   main module); only the `/package.json` subpath resolves, because an
 *   `exports`-less package permits any file-path subpath.
 * - `@anthropic-ai/claude-agent-sdk` (`dsh-subagent-claude-code`'s CLI
 *   dependency) declares an `exports` map with a `.` entry but no
 *   `./package.json` entry. The bare specifier resolves via `.`; the
 *   `/package.json` subpath throws `ERR_PACKAGE_PATH_NOT_EXPORTED`, because a
 *   declared `exports` map restricts resolution to exactly what it lists.
 *
 * Confirmed empirically this session (see report_path) with plain
 * `createRequire(...).resolve(...)` calls against both installed manifests
 * before this file was written.
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { harnessCliResolvable } from '../src/index.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../../..')
const codexWrapperManifest = path.join(repoRoot, 'packages/subagent/subagent-codex/package.json')
const claudeCodeWrapperManifest = path.join(repoRoot, 'packages/subagent/subagent-claude-code/package.json')

describe('harnessAvailable — real environment, no fakes (Mars r2 F1-r2)', () => {
  it('resolves @openai/codex — a bin-only package (no main/exports) where only the /package.json subpath form resolves', () => {
    const resolver = createRequire(codexWrapperManifest)
    expect(
      harnessCliResolvable(resolver, '@deepseek-ai/dsh-subagent-codex', '@openai/codex', createRequire),
    ).toBe(true)
  })

  it('resolves @anthropic-ai/claude-agent-sdk — an exports-mapped package where only the bare specifier form resolves', () => {
    const resolver = createRequire(claudeCodeWrapperManifest)
    expect(
      harnessCliResolvable(resolver, '@deepseek-ai/dsh-subagent-claude-code', '@anthropic-ai/claude-agent-sdk', createRequire),
    ).toBe(true)
  })

  it('is false for a CLI specifier that resolves in neither form', () => {
    const resolver = createRequire(codexWrapperManifest)
    expect(
      harnessCliResolvable(resolver, '@deepseek-ai/dsh-subagent-codex', '@openai/does-not-exist-xyz', createRequire),
    ).toBe(false)
  })
})
