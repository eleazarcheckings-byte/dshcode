// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {} from '../src/client/apply.ts'
import type { DraftAttachmentId, InputState } from '../src/client/contract/input.ts'
import { en } from '../src/client/locales.ts'
import { AmbientMotionControl, AmbientSky, type AmbientMotionControlProps, type AmbientSkyProps } from '../src/client/skeleton/AmbientSky.tsx'
import { createAmbientMotion } from '../src/client/skeleton/ambient-motion.ts'
import type { OrbitalCanvasProps } from '../src/client/skeleton/OrbitalCanvas.tsx'

vi.mock('../src/client/skeleton/OrbitalCanvas.tsx', () => ({
  OrbitalCanvas: ({ motion, state }: OrbitalCanvasProps) => <canvas data-motion={motion} data-state={state} />,
}))

const initialInput: InputState = { draft: '', imageIds: [], draftRev: 0, phase: 'plain', occurrences: [], queue: [] }
const initialUrl = window.location.href

function bench() {
  const preference = createAmbientMotion()
  const input = createSnapshotStore<InputState>(initialInput)
  const useAmbientMotion = bindSnapshotSelector(preference.hooks.ambientMotion)
  const sky = { useInput: bindSnapshotSelector(input), useAmbientMotion } as AmbientSkyProps
  const control = { useAmbientMotion, setAmbientMotion: preference.setAmbientMotion, t: makeTranslate(en) } as AmbientMotionControlProps
  return { preference, input, sky, control }
}

beforeEach(() => { localStorage.clear(); window.history.replaceState(null, '', initialUrl) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', initialUrl) })

describe('global ambient sky', () => {
  it('shares one live preference between the canvas and its global control', () => {
    const b = bench()
    const view = render(<><AmbientSky {...b.sky} /><AmbientMotionControl {...b.control} /></>)
    const canvas = view.container.querySelector('canvas')
    expect(view.container.querySelectorAll('canvas')).toHaveLength(1)
    expect(canvas?.dataset.motion).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: en['hero.motionLabel'] }))
    expect(canvas?.dataset.motion).toBe('false')
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false')
    expect(b.preference.hooks.ambientMotion.getSnapshot()).toBe(false)
  })

  it('holds the sky while either a text draft or an image draft exists', () => {
    const b = bench(), view = render(<AmbientSky {...b.sky} />)
    const canvas = view.container.querySelector('canvas')
    expect(canvas?.dataset.state).toBe('idle')
    act(() => { b.input.set({ ...initialInput, draft: 'Work in progress' }) })
    expect(canvas?.dataset.state).toBe('drafting')
    act(() => { b.input.set({ ...initialInput, imageIds: ['draft-image' as DraftAttachmentId] }) })
    expect(canvas?.dataset.state).toBe('drafting')
    act(() => { b.input.set(initialInput) })
    expect(canvas?.dataset.state).toBe('idle')
  })

  it('keeps an empty focused composer moving and pauses while another text field is edited', async () => {
    const b = bench()
    const view = render(<><AmbientSky {...b.sky} /><textarea data-composer-input="" aria-label="Composer" /><input type="search" aria-label="Search" /><button>Elsewhere</button></>)
    const canvas = view.container.querySelector('canvas')
    act(() => { screen.getByRole('textbox', { name: 'Composer' }).focus() })
    expect(canvas?.dataset.state).toBe('focused')
    act(() => { screen.getByRole('searchbox').focus() })
    expect(canvas?.dataset.state).toBe('drafting')
    await act(async () => { screen.getByRole('button', { name: 'Elsewhere' }).focus(); await Promise.resolve() })
    expect(canvas?.dataset.state).toBe('idle')
  })

  it('keeps non-editing controls quiet and recognizes contenteditable input', () => {
    const b = bench()
    const view = render(<><AmbientSky {...b.sky} /><input aria-label="Read only" readOnly /><input type="checkbox" aria-label="Option" /><div contentEditable tabIndex={0} data-editor="" /></>)
    const canvas = view.container.querySelector('canvas')
    act(() => { screen.getByRole('textbox').focus() })
    expect(canvas?.dataset.state).toBe('idle')
    act(() => { screen.getByRole('checkbox').focus() })
    expect(canvas?.dataset.state).toBe('idle')
    const editor = view.container.querySelector<HTMLElement>('[data-editor]')!
    // jsdom does not implement HTMLElement.isContentEditable, so supply the browser-owned fact.
    Object.defineProperty(editor, 'isContentEditable', { value: true })
    act(() => { editor.focus() })
    expect(canvas?.dataset.state).toBe('drafting')
  })

  it('renders the global sky before a session is selected', () => {
    const b = bench()
    const view = render(<AmbientSky {...b.sky} useInput={() => undefined} />)
    expect(view.container.querySelector('canvas')?.dataset.state).toBe('idle')
  })

  it('leaves both decorative sky and global control out of the SaturnBot window', () => {
    window.history.replaceState(null, '', '/?saturnbot=1')
    const b = bench()
    const view = render(<><AmbientSky {...b.sky} /><AmbientMotionControl {...b.control} /></>)
    expect(view.container.querySelector('canvas')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('keeps the control usable when preference storage is denied', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Unavailable', 'SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Unavailable', 'SecurityError') })
    const b = bench()
    render(<AmbientMotionControl {...b.control} />)
    expect(b.preference.hooks.ambientMotion.getSnapshot()).toBe(true)
    fireEvent.click(screen.getByRole('button'))
    expect(b.preference.hooks.ambientMotion.getSnapshot()).toBe(false)
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false')
  })

  it('removes focus observers and ignores a queued blur observation after unmount', async () => {
    const removeDocument = vi.spyOn(document, 'removeEventListener'), removeWindow = vi.spyOn(window, 'removeEventListener')
    const b = bench(), view = render(<AmbientSky {...b.sky} />)
    fireEvent.focusOut(document.body)
    view.unmount()
    await act(async () => { await Promise.resolve() })
    expect(removeDocument).toHaveBeenCalledWith('focusin', expect.any(Function))
    expect(removeDocument).toHaveBeenCalledWith('focusout', expect.any(Function))
    expect(removeWindow).toHaveBeenCalledWith('focus', expect.any(Function))
  })
})
