/** Smoke cleanup must remove profile links without touching their package targets. */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

interface SmokeHelper {
  removeSmokeScratch: (directory: string) => void
  redactSmokeOutput: (output: string) => string
}
// The release helper is an import-safe JavaScript script, outside TypeScript emission.
const { removeSmokeScratch, redactSmokeOutput } = await import(new URL('../scripts/smoke-packaged-startup.mjs', import.meta.url).href) as SmokeHelper
const scratch: string[] = []

function temporaryRoot(): string {
  const path = mkdtempSync(join(tmpdir(), 'saturn-ai-startup-'))
  scratch.push(path)
  return path
}

afterEach(() => {
  for (const path of scratch.splice(0).reverse()) removeSmokeScratch(path)
})

describe('packaged startup smoke helper', () => {
  it('unlinks a profile package junction while preserving its external target', () => {
    const target = temporaryRoot()
    writeFileSync(join(target, 'keep.txt'), 'package contents remain intact')
    const root = temporaryRoot()
    mkdirSync(join(root, 'profiles', 'node_modules'), { recursive: true })
    symlinkSync(target, join(root, 'profiles', 'node_modules', 'package'), 'junction')
    writeFileSync(join(root, 'result.json'), '{"ok":true}')
    removeSmokeScratch(root)
    expect(existsSync(root)).toBe(false)
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('package contents remain intact')
  })

  it('rejects the temp directory itself and a link-shaped scratch root', () => {
    expect(() => { removeSmokeScratch(tmpdir()) }).toThrow('Refusing cleanup outside')
    const target = temporaryRoot()
    const root = temporaryRoot()
    removeSmokeScratch(root)
    symlinkSync(target, root, 'junction')
    try {
      expect(() => { removeSmokeScratch(root) }).toThrow('link or non-directory')
      expect(existsSync(target)).toBe(true)
    } finally { unlinkSync(root) }
  })

  it('removes preview tokens from child output while preserving launch diagnostics', () => {
    const output = redactSmokeOutput('dsh web: http://127.0.0.1:1234/?token=single-use-secret#private\nLaunch failed: EADDRINUSE\nhttps://user:password@example.com/path?secret=value')
    expect(output).toContain('http://127.0.0.1:1234/')
    expect(output).toContain('Launch failed: EADDRINUSE')
    expect(output).toContain('https://example.com/path')
    expect(output).not.toMatch(/single-use-secret|private|password|secret=value/)
  })
})
