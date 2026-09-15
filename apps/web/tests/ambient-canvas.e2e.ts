/** Full-window ambient sky through the shipped Web composition, without model calls. */
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const CANVAS = '[data-shell-background] canvas'

/** Compare actual backing pixels after layout settles and twelve browser frames pass. */
async function pixelsChange(canvas: Locator): Promise<boolean> {
  return await canvas.evaluate(async (element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('ambient canvas missing')
    const frame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => { resolve() }))
    await frame()
    await frame()
    const before = element.toDataURL()
    for (let index = 0; index < 12; index++) await frame()
    return element.toDataURL() !== before
  })
}

/** The hidden SVG uses the same planet origin as the painter, so its geometry remains observable. */
async function planetAlignmentError(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const anchor = document.querySelector('[data-saturn-anchor]')?.getBoundingClientRect()
    const planet = document.querySelector('[data-shell-background] svg[viewBox="0 0 720 250"]')?.getBoundingClientRect()
    if (anchor === undefined || planet === undefined || planet.width === 0 || anchor.width === 0) return Infinity
    return Math.max(
      Math.abs(planet.left + planet.width / 2 - (anchor.left + anchor.width / 2)),
      Math.abs(planet.top + planet.height * 130 / 250 - (anchor.top + anchor.height * 0.52)),
    )
  })
}

async function assertFullFrame(page: Page): Promise<void> {
  expect(await page.locator('[data-shell-frame] canvas').count()).toBe(1)
  await expect.poll(() => page.evaluate(() => {
    const frame = document.querySelector('[data-shell-frame]')?.getBoundingClientRect()
    const canvas = document.querySelector('[data-shell-background] canvas')?.getBoundingClientRect()
    if (frame === undefined || canvas === undefined || canvas.width === 0) return Infinity
    return Math.max(...(['left', 'top', 'width', 'height'] as const).map(key => Math.abs(frame[key] - canvas[key])))
  })).toBeLessThan(1)
  expect(await page.locator(CANVAS).evaluate((element) => {
    const styles: { mask: string; clip: string; pointer: string }[] = []
    for (let node: Element | null = element; node !== null && !node.matches('[data-shell-frame]'); node = node.parentElement) {
      const style = getComputedStyle(node)
      styles.push({ mask: style.maskImage, clip: style.clipPath, pointer: style.pointerEvents })
    }
    return styles.every(style => style.mask === 'none' && style.clip === 'none' && style.pointer === 'none')
  })).toBe(true)
  expect(await page.locator('[data-shell-background]').getAttribute('aria-hidden')).toBe('true')
}

describe('web e2e: one ambient canvas across the application', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    await scaffold.ctx.settings.mutate('ui-first-light', [{ op: 'set', path: ['complete'], value: '2026-09-14.1' }])
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    // Both sidebar widths leave the hero at its cap, exposing position-only changes.
    await page.setViewportSize({ width: 1920, height: 1000 })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.locator(`${CANVAS}[data-rendered]`).waitFor({ timeout: 30_000 })
    await page.locator('[data-saturn-anchor]').waitFor()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('covers desktop and narrow frames and tracks the planet while paused during sidebar movement', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-ambient-geometry'))
    const canvas = page.locator(CANVAS)
    const motion = page.getByRole('button', { name: 'Ambient motion preference' })
    await assertFullFrame(page)
    await expect.poll(() => pixelsChange(canvas)).toBe(true)
    await motion.click()
    await expect.poll(() => motion.getAttribute('aria-pressed')).toBe('false')
    expect(await pixelsChange(canvas)).toBe(false)
    await expect.poll(() => planetAlignmentError(page)).toBeLessThan(1)
    const initialAnchor = await page.locator('[data-saturn-anchor]').boundingBox()
    if (initialAnchor === null) throw new Error('planet anchor missing')

    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    await expect.poll(() => page.locator('[data-shell-frame]').getAttribute('data-sidebar-collapsed')).toBe('true')
    await expect.poll(() => page.locator('[data-shell-frame]').evaluate(element =>
      element.getAnimations().every(animation => animation.playState !== 'running'),
    )).toBe(true)
    const collapsedAnchor = await page.locator('[data-saturn-anchor]').boundingBox()
    if (collapsedAnchor === null) throw new Error('planet anchor missing after collapse')
    expect(collapsedAnchor.width).toBeCloseTo(initialAnchor.width, 0)
    expect(Math.abs(collapsedAnchor.x - initialAnchor.x)).toBeGreaterThan(50)
    await expect.poll(() => planetAlignmentError(page)).toBeLessThan(1)
    expect(await pixelsChange(canvas)).toBe(false)

    await page.setViewportSize({ width: 580, height: 900 })
    await assertFullFrame(page)
    await expect.poll(() => planetAlignmentError(page)).toBeLessThan(1)
    expect(await pixelsChange(canvas)).toBe(false)
    await page.setViewportSize({ width: 1680, height: 1000 })
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
    await expect.poll(() => planetAlignmentError(page)).toBeLessThan(1)
    await assertFullFrame(page)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps the canvas mounted when a workspace connects and pauses actual pixels while writing or reducing motion', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-ambient-writing'))
    const original = await page.locator(CANVAS).elementHandle()
    if (original === null) throw new Error('ambient canvas missing')
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    expect(await original.evaluate(element => element === document.querySelector('[data-shell-background] canvas'))).toBe(true)
    await original.dispose()
    await assertFullFrame(page)
    const canvas = page.locator(CANVAS)
    const field = page.locator('[data-shell-background] [data-orbital-state]')
    const motion = page.getByRole('button', { name: 'Ambient motion preference' })
    await motion.click()
    await expect.poll(() => motion.getAttribute('aria-pressed')).toBe('true')
    await expect.poll(() => pixelsChange(canvas)).toBe(true)

    const composer = page.locator('[data-composer-input][contenteditable="true"]').first()
    await composer.fill('Keep this draft local while I think.')
    await expect.poll(() => field.getAttribute('data-orbital-state')).toBe('drafting')
    expect(await pixelsChange(canvas)).toBe(false)
    await page.getByRole('heading', { level: 1 }).click()
    expect(await field.getAttribute('data-orbital-state')).toBe('drafting')
    expect(await pixelsChange(canvas)).toBe(false)
    await composer.fill('')
    await expect.poll(() => field.getAttribute('data-orbital-state')).toBe('focused')
    await expect.poll(() => pixelsChange(canvas)).toBe(true)

    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await motion.getAttribute('aria-pressed')).toBe('true')
    expect(await pixelsChange(canvas)).toBe(false)
    await page.setViewportSize({ width: 1280, height: 880 })
    await assertFullFrame(page)
    await expect.poll(() => planetAlignmentError(page)).toBeLessThan(1)
    expect(await pixelsChange(canvas)).toBe(false)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect.poll(() => pixelsChange(canvas)).toBe(true)
    await motion.click()
    await page.setViewportSize({ width: 1680, height: 1000 })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps Settings above the main content and leaves foreground controls usable', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-ambient-settings'))
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    await dialog.waitFor()
    expect(await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return element.contains(document.elementFromPoint(rect.right - 40, rect.top + 40))
    })).toBe(true)
    const general = dialog.getByRole('button', { name: 'General', exact: true })
    await general.click()
    expect(await general.getAttribute('aria-current')).toBe('true')
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'New session', exact: true }).last().click()
    await page.locator('[data-composer-input][contenteditable="true"]').first().click()
    await assertFullFrame(page)
    const screenshot = process.env['DSH_AMBIENT_SCREENSHOT']
    if (screenshot !== undefined) await page.screenshot({ path: screenshot, fullPage: true })
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)
})
