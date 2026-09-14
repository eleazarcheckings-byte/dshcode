import { describe, expect, it } from 'vitest'
import { aboutSurface } from '../src/about.ts'

const RUNTIME = { electron: '43.4.0', chrome: '140.0.0.0', node: '24.15.0' }

describe('desktop About surface copy', () => {
  it('heads the surface with the product name and names the packaged version', () => {
    const surface = aboutSurface('Saturn AI', '1.1.0', RUNTIME)
    expect(surface.message).toBe('Saturn AI')
    expect(surface.detail).toContain('Version 1.1.0')
  })

  it('reports the runtime stack of the running process', () => {
    const surface = aboutSurface('Saturn AI', '1.1.0', RUNTIME)
    expect(surface.detail).toContain('Electron 43.4.0 · Chromium 140.0.0.0 · Node 24.15.0')
  })

  it('carries the MIT attribution line pointing at the shipped notices', () => {
    const surface = aboutSurface('Saturn AI', '1.1.0', RUNTIME)
    expect(surface.detail).toContain('MIT licensed.')
    expect(surface.detail).toContain('licenses/')
  })

  it('composes every label from the supplied product name', () => {
    expect(aboutSurface('Forked Name', '0.0.1', RUNTIME).message).toBe('Forked Name')
  })
})
