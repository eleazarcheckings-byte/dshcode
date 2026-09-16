// @vitest-environment jsdom
/**
 * The multi-task chip must never look the same in every state (izzy,
 * 2026-09-16: "make sure the button indicates when its on /off it always
 * looks like the same right now"). Three states, three distinct contracts:
 *
 * - OFF: `aria-pressed=false`, the `off` class, a visible "OFF" tag.
 * - ON: `aria-pressed=true`, the `on` class, a visible "ON" tag.
 * - PENDING: the `pending` class layers on top, and the title explains the
 *   change lands next turn — never painted as if it had already landed.
 *
 * State never rides color alone: the ON/OFF tag text and `aria-pressed`
 * carry it. The companion `toggle-state-styles.client.spec.ts` (plain Node
 * environment — CSS-text assertions never share a jsdom-pragma file with
 * `import.meta.url` reads in this package's test convention) proves the
 * `on` and `off` selectors actually declare different `background` and
 * `border`, so the chip paints differently and not merely carries a
 * different class name.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { OrchestrateToggle, type OrchestrateToggleProps } from '../src/client/OrchestrateToggle.tsx'
import { en, zh } from '../src/client/locales.ts'
import css from '../src/client/OrchestrateToggle.module.css'

afterEach(cleanup)

const t = makeTranslate(en) as OrchestrateToggleProps['t']
const tZh = makeTranslate(zh) as OrchestrateToggleProps['t']

/** Render the toggle over a fixed projection, with a no-op toggle callback. */
function renderToggle(projection: { active: boolean; pending: boolean }, translate = t) {
  const props = {
    useProjection: (name: string) => (name === 'orchestrate' ? projection : undefined),
    toggle: async () => null,
    t: translate,
  } as unknown as OrchestrateToggleProps
  const view = render(<OrchestrateToggle {...props} />)
  const button = view.container.querySelector('button')
  if (button === null) throw new Error('the toggle rendered no button')
  return { view, button }
}

describe('OrchestrateToggle — state visuals', () => {
  it('renders OFF: aria-pressed false, the off class, and a visible OFF tag', () => {
    const { button } = renderToggle({ active: false, pending: false })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(css.off).toBeTruthy()
    expect(button.classList.contains(css.off as string)).toBe(true)
    expect(button.classList.contains(css.on as string)).toBe(false)
    expect(button.textContent).toContain('OFF')
  })

  it('renders ON: aria-pressed true, the on class, and a visible ON tag', () => {
    const { button } = renderToggle({ active: true, pending: false })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(css.on).toBeTruthy()
    expect(button.classList.contains(css.on as string)).toBe(true)
    expect(button.classList.contains(css.off as string)).toBe(false)
    expect(button.textContent).toContain('ON')
  })

  it('renders PENDING: the pending class, and a title explaining it applies next turn', () => {
    const { button } = renderToggle({ active: false, pending: true })
    expect(css.pending).toBeTruthy()
    expect(button.classList.contains(css.pending as string)).toBe(true)
    expect(button.getAttribute('title')).toBe(en['toggle.pending.title'])
  })

  it('never lets color alone carry the state: the zh dictionary also names ON/OFF as visible tag text', () => {
    const off = renderToggle({ active: false, pending: false }, tZh)
    expect(off.button.textContent).toContain('OFF')
    const on = renderToggle({ active: true, pending: false }, tZh)
    expect(on.button.textContent).toContain('ON')
  })
})
