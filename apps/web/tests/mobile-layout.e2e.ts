// Web e2e scenario: the shell at phone size (SPEC §8 M2). One 390x844 page
// over the real composition proves the three claims the unit specs cannot —
// that the assembled document never scrolls sideways, that the sidebar
// arrives as a drawer opened from the title strip and leaves on a route
// change, and that the composer clears the band an open keyboard covers.
//
// The seed is the committed seeded-history recording, borrowed read-only: the
// scenario owns no fixture, records nothing, and makes no model call, so a
// stray stream fails loud on the open llm seam exactly as in that scenario.
// The keyboard is simulated by writing the same custom property the
// visualViewport listener publishes (`keyboard-inset.ts`); Chromium has no
// on-screen keyboard to raise, and the property IS the contract between the
// listener and the sheet.
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { REPO_ROOT, saveFailureShot } from './support.ts'

const SEED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.jsonl', import.meta.url))
const SEED_ID = 'mobile-layout-web-e2e'
const MODE = webSnapshotMode()

/** iPhone 14 Pro logical viewport — the SPEC's acceptance size. */
const VIEWPORT = { width: 390, height: 844 }
/** Band a typical iOS keyboard covers; the simulated inset below. */
const KEYBOARD_BAND = 336
/** Minimum touch target, in CSS px. */
const TAP_TARGET = 44

/** Screenshots land where every sibling scenario puts them, beside the repo. */
const SHOT_DIR = join(REPO_ROOT, '.artifacts')

/** Widest horizontal extent the document reports, the overflow oracle. */
function documentScrollWidth(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth)
}

/**
 * Smallest touch target across the whole mobile chrome — the title strip, the
 * drawer, the conversation header and the composer seat, which is exactly the
 * set the global sheet claims to raise to 44px. Sampling only the drawer left
 * the header (view tabs, the actions and utilities seats) outside the gate.
 * @param page - the 390x844 page under test.
 * @returns the smallest side in CSS px, with the control that reported it.
 */
function smallestTapTarget(page: Page): Promise<{ side: number; control: string }> {
  return page.evaluate(() => {
    const roots = document.querySelectorAll(
      '[data-mobile-strip], [data-mobile-drawer], [data-conversation-header], [data-composer-seat]')
    let side = Number.POSITIVE_INFINITY
    let control = '(no control rendered)'
    for (const root of roots) {
      for (const element of root.querySelectorAll('button, [role="tab"], [role="treeitem"]')) {
        const box = element.getBoundingClientRect()
        if (box.width === 0 || box.height === 0) continue
        const smaller = Math.min(box.width, box.height)
        if (smaller >= side) continue
        side = smaller
        control = `${element.tagName} "${(element.textContent ?? '').trim().slice(0, 32)}"`
          + ` (${Math.round(box.width)}x${Math.round(box.height)})`
      }
    }
    return { side, control }
  })
}

describe.skipIf(MODE === 'record')('web e2e: mobile layout at 390x844', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await mkdir(join(scaffold.workspaceCwd, 'workspace'), { recursive: true })
    await seedSession(scaffold, await readFile(SEED, 'utf8'), SEED_ID)
    await mkdir(SHOT_DIR, { recursive: true })

    browser = await chromium.launch()
    page = await browser.newPage({
      viewport: VIEWPORT,
      locale: 'en-US',
      timezoneId: 'Asia/Shanghai',
      hasTouch: true,
      deviceScaleFactor: 3,
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[data-shell-frame][data-mobile]', { timeout: 30_000 })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('opens the sidebar as a drawer from the title strip and closes it on a route change', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mobile-layout-drawer'))
    const frame = page.locator('[data-shell-frame]')
    const menu = page.locator('[data-mobile-menu]')
    await menu.waitFor({ timeout: 15_000 })

    // Closed: the drawer is mounted but off-canvas and unreachable by touch.
    expect(await frame.getAttribute('data-drawer-open')).toBeNull()
    expect(await page.locator('[data-mobile-drawer]').evaluate(el =>
      Math.round(el.getBoundingClientRect().right))).toBeLessThanOrEqual(0)

    await menu.click()
    await expect.poll(() => frame.getAttribute('data-drawer-open'), { timeout: 5_000 }).toBe('true')
    const panel = page.locator('[data-mobile-drawer]')
    await expect.poll(() => panel.evaluate(el => Math.round(el.getBoundingClientRect().left)), { timeout: 5_000 })
      .toBe(0)
    // The panel takes the column, not the whole screen: the conversation
    // stays visible behind the backdrop, which is what makes it a drawer.
    const panelWidth = await panel.evaluate(el => el.getBoundingClientRect().width)
    expect(panelWidth).toBeGreaterThan(VIEWPORT.width * 0.6)
    expect(panelWidth).toBeLessThan(VIEWPORT.width)
    expect(await page.locator('[data-mobile-backdrop]').evaluate(el =>
      getComputedStyle(el).pointerEvents)).toBe('auto')

    // Every control the phone chrome offers is a real touch target — the
    // drawer AND the strip, the conversation header and the composer seat.
    const withDrawer = await smallestTapTarget(page)
    expect(withDrawer.side, withDrawer.control).toBeGreaterThanOrEqual(TAP_TARGET)

    await page.screenshot({ path: join(SHOT_DIR, 'mobile-drawer-open.png') })

    // A route change dismisses it: open the seeded workspace group, then the
    // session row inside the drawer.
    await panel.locator('[role="treeitem"]').first().click()
    const sessionRow = panel.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await expect.poll(() => frame.getAttribute('data-drawer-open'), { timeout: 10_000 }).toBeNull()
    await expect.poll(() => page.getByText('DONE', { exact: true }).count(), { timeout: 20_000 }).toBe(1)
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('keeps the composer above the keyboard and never scrolls sideways', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mobile-layout-composer'))
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 15_000 })

    // Resting: the composer sits above the bottom safe area.
    expect(await documentScrollWidth(page)).toBeLessThanOrEqual(VIEWPORT.width)

    // The seeded session is open, so the conversation header (crumbs, view
    // tabs, the actions and utilities seats) is on screen here and nowhere
    // else — this is the reading that covers it.
    await page.locator('[data-conversation-header]').first().waitFor({ timeout: 15_000 })
    const resting = await smallestTapTarget(page)
    expect(resting.side, resting.control).toBeGreaterThanOrEqual(TAP_TARGET)

    // Keyboard open: publish the inset the visualViewport listener would.
    await page.evaluate((band: number) => {
      document.documentElement.style.setProperty('--saturn-keyboard-inset', `${band}px`)
    }, KEYBOARD_BAND)
    await expect.poll(
      () => input.evaluate(element => Math.round(element.getBoundingClientRect().bottom)),
      { timeout: 5_000 },
    ).toBeLessThanOrEqual(VIEWPORT.height - KEYBOARD_BAND)
    // Still fully on screen — the padding lifted it, it did not clip it.
    expect(await input.evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThan(0)
    expect(await documentScrollWidth(page)).toBeLessThanOrEqual(VIEWPORT.width)

    await page.screenshot({ path: join(SHOT_DIR, 'mobile-composer-keyboard.png') })
    await page.evaluate(() => { document.documentElement.style.removeProperty('--saturn-keyboard-inset') })

    // The whole transcript, tool rows included, stays inside the viewport.
    const widest = await page.evaluate(() => Math.max(...[...document.querySelectorAll('[data-tool], [data-conversation-scroll], [data-composer-seat]')]
      .map(element => Math.round(element.getBoundingClientRect().right))))
    expect(widest).toBeLessThanOrEqual(VIEWPORT.width)
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)
})
