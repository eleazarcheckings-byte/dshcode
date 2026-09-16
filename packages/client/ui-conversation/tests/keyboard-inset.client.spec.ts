// @vitest-environment jsdom
/**
 * Composer survival while the on-screen keyboard is open (SPEC §8 M2). iOS
 * does not shrink the layout viewport for the keyboard, so a bottom-docked
 * composer would sit underneath it; the visual viewport is the only surface
 * that reports the covered band. The measurement is a pure function and the
 * subscription is a plain installer, so both are provable without a renderer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installKeyboardInset, KEYBOARD_INSET_PROPERTY, keyboardInset,
} from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/keyboard-inset.ts'

/** Minimal driven stand-in for the browser's visualViewport. */
function fakeVisualViewport(height: number, offsetTop = 0) {
  const listeners = new Map<string, Set<() => void>>()
  return {
    height,
    offsetTop,
    addEventListener(type: string, listener: () => void) {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener))
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener)
    },
    emit(type: string) { listeners.get(type)?.forEach((listener) => { listener() }) },
    listenerCount(type: string) { return listeners.get(type)?.size ?? 0 },
  }
}

afterEach(() => {
  document.documentElement.removeAttribute('style')
  vi.restoreAllMocks()
})

describe('keyboardInset', () => {
  it('is zero while no keyboard covers the layout viewport', () => {
    expect(keyboardInset(844, { height: 844, offsetTop: 0 })).toBe(0)
  })

  it('reports the band the keyboard covers', () => {
    expect(keyboardInset(844, { height: 508, offsetTop: 0 })).toBe(336)
  })

  it('subtracts a pinch-scrolled offset so the composer is not double-padded', () => {
    expect(keyboardInset(844, { height: 500, offsetTop: 44 })).toBe(300)
  })

  it('never goes negative, and rounds to whole pixels', () => {
    expect(keyboardInset(844, { height: 900, offsetTop: 0 })).toBe(0)
    expect(keyboardInset(844, { height: 507.4, offsetTop: 0 })).toBe(337)
  })

  it('is zero on an engine with no visual viewport', () => {
    expect(keyboardInset(844, undefined)).toBe(0)
  })
})

describe('installKeyboardInset', () => {
  it('publishes the inset and keeps it current on resize and scroll', () => {
    const target = document.createElement('div')
    const viewport = fakeVisualViewport(844)
    const view = { innerHeight: 844, visualViewport: viewport } as unknown as Window
    const dispose = installKeyboardInset(target, view)
    expect(target.style.getPropertyValue(KEYBOARD_INSET_PROPERTY)).toBe('0px')

    viewport.height = 508
    viewport.emit('resize')
    expect(target.style.getPropertyValue(KEYBOARD_INSET_PROPERTY)).toBe('336px')

    viewport.offsetTop = 8
    viewport.emit('scroll')
    expect(target.style.getPropertyValue(KEYBOARD_INSET_PROPERTY)).toBe('328px')
    dispose()
  })

  it('unsubscribes and clears the property on dispose', () => {
    const target = document.createElement('div')
    const viewport = fakeVisualViewport(844)
    const view = { innerHeight: 844, visualViewport: viewport } as unknown as Window
    const dispose = installKeyboardInset(target, view)
    expect(viewport.listenerCount('resize')).toBe(1)
    expect(viewport.listenerCount('scroll')).toBe(1)
    dispose()
    expect(viewport.listenerCount('resize')).toBe(0)
    expect(viewport.listenerCount('scroll')).toBe(0)
    expect(target.style.getPropertyValue(KEYBOARD_INSET_PROPERTY)).toBe('')
  })

  it('publishes a zero inset and disposes cleanly without a visual viewport', () => {
    const target = document.createElement('div')
    const view = { innerHeight: 844, visualViewport: undefined } as unknown as Window
    const dispose = installKeyboardInset(target, view)
    expect(target.style.getPropertyValue(KEYBOARD_INSET_PROPERTY)).toBe('0px')
    expect(() => { dispose() }).not.toThrow()
    expect(target.style.getPropertyValue(KEYBOARD_INSET_PROPERTY)).toBe('')
  })
})
