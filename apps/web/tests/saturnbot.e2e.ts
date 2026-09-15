/** Real shipped popup, generated Remote, role execution, SQLite memory, and reports; only LLM output is scripted. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type Page, type Locator } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type {} from '@saturnai/dsh-saturnbot'
import { MockAdapter, textResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

describe('web e2e: SaturnBot operating workspace', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let popup: Page
  let dashboard: Locator
  let adapter: MockAdapter
  let mainConsole: ReturnType<typeof watchConsole>
  let botConsole: ReturnType<typeof watchConsole>

  const openBot = async (): Promise<Page> => {
    const opened = page.waitForEvent('popup')
    await page.getByRole('button', { name: 'Open SaturnBot in a separate window' }).click()
    const child = await opened
    dashboard = child.locator('[data-saturnbot-dashboard]')
    botConsole = watchConsole(child)
    await child.setViewportSize({ width: 1440, height: 1000 })
    await child.waitForSelector('[data-saturnbot-dashboard]', { timeout: 30_000 })
    await child.getByRole('heading', { name: 'Chief of Staff', exact: true }).waitFor()
    return child
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    await scaffold.ctx.settings.mutate('ui-first-light', [{ op: 'set', path: ['complete'], value: '2026-09-14.1' }])
    adapter = new MockAdapter([
      textResponse(JSON.stringify({
        summary: 'I will save the onboarding support focus for future runs.',
        actions: [{ tool: 'memory.write', input: { key: 'support-focus', value: 'Help new users finish onboarding.' } }],
      })),
      'hang',
    ])
    scaffold.ctx.llm.registerAdapter(['saturnbot-browser-fixture'], adapter)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    mainConsole = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    popup = await openBot()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('loads the real dashboard baseline when the popup starts hidden', async () => {
    const hiddenPopup = await browser.newPage({ storageState: await page.context().storageState(), locale: 'en-US' })
    try {
      await hiddenPopup.addInitScript(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      })
      const response = hiddenPopup.waitForResponse(result =>
        new URL(result.url()).pathname === '/api/saturnbot/snapshot' && result.status() === 200,
      )
      const url = new URL('/', page.url())
      url.searchParams.set('saturnbot', '1')
      await hiddenPopup.goto(url.href, { waitUntil: 'load' })
      await response
      expect(await hiddenPopup.evaluate(() => document.hidden)).toBe(true)
      await hiddenPopup.locator('[data-saturnbot-dashboard]').getByRole('textbox', { name: 'Message Chief of Staff…', exact: true }).waitFor()
      expect(await hiddenPopup.getByText('Connecting to SaturnBot', { exact: true }).count()).toBe(0)
    } finally { await hiddenPopup.close() }
  }, 30_000)

  it('configures a specialist, persists its real memory action, and reopens its conversation and briefing', async () => {
    onTestFailed(() => saveFailureShot(popup, 'web-e2e-saturnbot'))
    expect(new URL(popup.url()).searchParams.get('saturnbot')).toBe('1')
    expect(new URL(page.url()).searchParams.has('saturnbot')).toBe(false)

    await dashboard.getByRole('button', { name: 'Settings', exact: true }).click()
    await dashboard.getByRole('textbox', { name: 'Or enter an absolute workspace path', exact: true }).fill(scaffold.workspaceCwd)
    await dashboard.getByRole('textbox', { name: /^Business goal/ }).fill('Make onboarding clear and supportive.')
    await dashboard.getByRole('textbox', { name: 'Provider', exact: true }).fill('saturnbot-browser-fixture')
    await dashboard.getByRole('textbox', { name: 'Model', exact: true }).fill('fixture')
    await dashboard.getByText('Advanced configuration', { exact: true }).click()
    await dashboard.getByRole('textbox', { name: /^Allowed tools/ }).fill('memory.search\nmemory.write')
    await dashboard.getByRole('button', { name: 'Save configuration', exact: true }).click()
    await dashboard.getByText('Configuration saved.', { exact: true }).waitFor()
    const configured = await scaffold.ctx.saturnbot.snapshot()
    expect(configured.config.goal).toBe('Make onboarding clear and supportive.')
    expect(configured.config.allowedTools).toEqual(['memory.search', 'memory.write'])

    await dashboard.getByRole('button', { name: /^Operations Keeps operational/ }).click()
    await dashboard.getByRole('button', { name: 'Agent settings', exact: true }).click()
    await dashboard.getByRole('textbox', { name: 'Standing instructions', exact: true }).fill('Record concrete customer-support priorities.')
    const memoryPermission = dashboard.getByRole('checkbox', { name: /^memory.write/ })
    await memoryPermission.uncheck()
    await dashboard.getByRole('button', { name: 'Save specialist', exact: true }).click()
    await dashboard.getByText('Configuration saved.', { exact: true }).waitFor()
    expect((await scaffold.ctx.saturnbot.snapshot()).config.roles.operations.tools).not.toContain('memory.write')
    await memoryPermission.check()
    await dashboard.getByRole('button', { name: 'Save specialist', exact: true }).click()
    await dashboard.getByText('Configuration saved.', { exact: true }).waitFor()
    await dashboard.getByRole('button', { name: 'Back to conversation', exact: true }).click()
    const message = 'Remember that onboarding support is our priority.'
    await dashboard.getByRole('textbox', { name: 'Message Operations…', exact: true }).fill(message)
    await dashboard.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect.poll(async () => (await scaffold.ctx.saturnbot.snapshot()).cycles[0]?.status, { timeout: 15_000 }).toBe('completed')
    await dashboard.getByRole('button', { name: 'Refresh', exact: true }).click()
    const conversation = dashboard.getByRole('log', { name: 'Conversation with Operations' })
    await conversation.getByText('I will save the onboarding support focus for future runs.', { exact: true }).waitFor()
    const messages = await conversation.locator('article[data-sender]').evaluateAll(elements => elements.map(element => ({
      sender: element.getAttribute('data-sender'), text: element.querySelector('[class*="messageBubble"]')?.textContent,
    })))
    expect(messages).toMatchInlineSnapshot(`
      [
        {
          "sender": "user",
          "text": "Remember that onboarding support is our priority.",
        },
        {
          "sender": "agent",
          "text": "I will save the onboarding support focus for future runs.",
        },
      ]
    `)
    expect((await scaffold.ctx.saturnbot.snapshot()).config.goal).toBe('Make onboarding clear and supportive.')
    expect(adapter.requests).toHaveLength(1)
    const persisted = await scaffold.ctx.sessionPersistence.readRaw(adapter.requests[0]!.sessionId!)
    expect(persisted?.content).toContain('saturnbot/model-request')
    expect(persisted?.content).toContain('Record concrete customer-support priorities.')
    expect(persisted?.content).toContain('saturnbot/model-result')

    await dashboard.getByRole('button', { name: 'Memory', exact: true }).click()
    await dashboard.getByRole('textbox', { name: 'Search saved memory', exact: true }).fill('support-focus')
    await dashboard.getByRole('button', { name: 'Search', exact: true }).click()
    await dashboard.getByText('Help new users finish onboarding.', { exact: true }).waitFor()
    expect(await scaffold.ctx.saturnbot.memory('support-focus')).toMatchObject([{ key: 'support-focus', value: 'Help new users finish onboarding.' }])
    const state = await scaffold.ctx.saturnbot.snapshot()
    expect(state.reports.length).toBeGreaterThan(0)
    await dashboard.getByRole('heading', { name: state.reports[0]!.title, exact: true, level: 2 }).waitFor()
    expect(await readFile(join(scaffold.harnessHome, 'saturnbot', 'reports', `${state.reports[0]!.date}.md`), 'utf8')).toContain('Remember that onboarding support is our priority.')

    await dashboard.getByRole('button', { name: 'Resume schedule', exact: true }).click()
    await dashboard.getByRole('button', { name: 'Pause schedule', exact: true }).click()
    await dashboard.getByRole('button', { name: 'Resume schedule', exact: true }).waitFor()
    expect((await scaffold.ctx.saturnbot.snapshot()).config.enabled).toBe(false)
    expect(botConsole.pageErrors).toEqual([])
    expect(botConsole.warnings).toEqual([])
    await popup.close()
    popup = await openBot()
    await dashboard.getByRole('button', { name: /^Operations I will save/ }).click()
    await dashboard.getByRole('log', { name: 'Conversation with Operations' }).locator('article[data-sender="user"]').getByText(message, { exact: true }).waitFor()
    await dashboard.getByRole('button', { name: 'Memory', exact: true }).click()
    await dashboard.getByText('Help new users finish onboarding.', { exact: true }).waitFor()
    await dashboard.getByRole('button', { name: 'Back to conversation', exact: true }).click()
    const screenshot = process.env['DSH_BOT_SCREENSHOT']
    if (screenshot !== undefined) await popup.screenshot({ path: screenshot, fullPage: true })
    expect(mainConsole.pageErrors).toEqual([])
    expect(botConsole.pageErrors).toEqual([])
    expect(botConsole.warnings).toEqual([])
  }, 90_000)

  it('stops a running role request through the popup and preserves its recorded message', async () => {
    onTestFailed(() => saveFailureShot(popup, 'web-e2e-saturnbot-cancel'))
    expect((await scaffold.ctx.saturnbot.snapshot()).config.workspace).toBe(scaffold.workspaceCwd)
    await dashboard.getByRole('button', { name: /^Operations/ }).click()
    await dashboard.getByRole('textbox', { name: 'Message Operations…', exact: true }).fill('Review the next support task.')
    await dashboard.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect.poll(() => adapter.requests.length).toBe(2)
    await dashboard.getByRole('button', { name: 'Stop current run', exact: true }).click()
    await expect.poll(async () => (await scaffold.ctx.saturnbot.snapshot()).activeCycle).toBeNull()
    const state = await scaffold.ctx.saturnbot.snapshot()
    expect(state.cycles[0]?.status).toBe('interrupted')
    expect(state.messages.some(message => message.sender === 'user' && message.content === 'Review the next support task.')).toBe(true)
    expect(await scaffold.ctx.saturnbot.memory('support-focus')).toHaveLength(1)
    expect(botConsole.pageErrors).toEqual([])
  }, 30_000)

  it('preserves an unsent draft when the launcher focuses its existing window', async () => {
    onTestFailed(() => saveFailureShot(popup, 'web-e2e-saturnbot-reopen'))
    const draft = 'Keep this unfinished operations request.'
    await dashboard.getByRole('textbox', { name: 'Message Operations…', exact: true }).fill(draft)
    const reload = popup.waitForEvent('domcontentloaded', { timeout: 1500 }).then(() => true, () => false)
    await page.getByRole('button', { name: 'Open SaturnBot in a separate window' }).click()
    expect(await reload, 'Focusing an open dashboard must preserve its local editor state.').toBe(false)
    expect(await dashboard.getByRole('textbox', { name: 'Message Operations…', exact: true }).inputValue()).toBe(draft)
    expect(page.context().pages().filter(candidate => new URL(candidate.url()).searchParams.get('saturnbot') === '1')).toHaveLength(1)
  }, 10_000)
})
