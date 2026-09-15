// Keyless assembled-browser coverage for the shipped Agent Teams Web surface
// over the real Host Typert Remote flow.
//
// The three Team rows (`agent-team`, `tool-agent-team`, `ui-agent-team`) ship
// once, in `packages/bundle/web-app/cordis.patch.yml` — the single home for a
// product's feature rows. The base-backed opt-in layers
// (`@saturnai/dsh-agent-team-profile` / `@saturnai/dsh-agent-team-web-profile`)
// are therefore NOT stacked here: composing them over the shipped Web bundle
// would declare those ids a second time, and the Loader rejects a repeated
// explicit id with `TypeError: duplicate loader entry id`, which fails the
// whole plugin tree.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/agent-team-panel', import.meta.url))
const PANEL_EXPECTED = join(SNAPSHOT_DIR, 'task.expected.md')
const WEB_APP_PATCH = fileURLToPath(new URL('../../../packages/bundle/web-app/cordis.patch.yml', import.meta.url))
const MODE = webSnapshotMode()

/**
 * Every explicit entry id one bundle patch declares: the top-level list, each
 * patch row's own `insert` list, and a group's `config` children — exactly the
 * positions `applyEntryPatches` flattens into the composed entry list. A config
 * payload that merely *names* an id (`disableControlsOnInstall`, `entryIds`) is
 * not an entry, so it is not counted; counting it would report the pre-existing
 * `web-ui` disable reference as a duplicate declaration.
 */
function declaredIds(path: string): string[] {
  const parsed = yaml.load(readFileSync(path, 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new Error(`patch at ${path} must be a list`)
  const ids: string[] = []
  const walk = (entries: unknown): void => {
    if (!Array.isArray(entries)) return
    for (const item of entries) {
      if (item === null || typeof item !== 'object') continue
      const entry = item as Record<string, unknown>
      if (typeof entry.id === 'string') ids.push(entry.id)
      walk(entry.insert)
      if (entry.group === true) walk(entry.config)
    }
  }
  walk(parsed)
  return ids
}

describe('shipped Agent Teams Web surface', () => {
  it('declares the three Team rows exactly once, in the shipped web bundle patch', () => {
    const ids = declaredIds(WEB_APP_PATCH)
    for (const id of ['agent-team', 'tool-agent-team', 'ui-agent-team']) {
      expect(ids.filter(candidate => candidate === id)).toHaveLength(1)
    }
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
    expect([...new Set(duplicates)]).toEqual([])
  })
})

describe('web e2e: Agent Teams panel', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const agent = scaffold.ctx.agents.list()[0]
    if (agent === undefined) throw new Error('connected Team workspace did not create an Agent')
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Open the Agent Team controls.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'Ready.' }],
        source: { kind: 'model', provider: 'fixture', model: 'fixture' },
      }),
    }, { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessions.flush(agent.session)
    await page.getByText('Ready.').waitFor({ timeout: 10_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('loads the roster and creates one shared task through generated Remote', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-agent-team-panel'))
    const action = page.locator('[data-team-action]')
    await action.getByRole('button', { name: /Agent Team/iu }).click()
    await action.getByText('No shared tasks yet').waitFor()
    await action.getByText('lead').waitFor()

    await action.getByRole('button', { name: 'New task' }).click()
    await action.getByPlaceholder('Task subject').fill('Browser task')
    await action.getByPlaceholder('Task description').fill('Created through the assembled browser')
    await action.getByPlaceholder(/Write scopes/iu).fill('src/web')
    await action.getByRole('button', { name: 'Save' }).click()
    await action.getByText('Browser task').waitFor()

    const snapshot = await captureStableAria(page, '[data-team-action]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(PANEL_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['task.expected.md'])
  })
})
