import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))

vi.mock('node:child_process', () => ({ spawn }))

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  killed = false

  kill(): void {
    this.killed = true
  }
}

describe('splitProgressLines', () => {
  it('splits on line breaks and drops empty fragments', async () => {
    const { splitProgressLines } = await import('../src/downloader.ts')
    expect(splitProgressLines('a\nb\r\nc\n\n')).toEqual(['a', 'b', 'c'])
    expect(splitProgressLines('')).toEqual([])
    expect(splitProgressLines('no newline')).toEqual(['no newline'])
  })
})

describe('resolvePlaywrightCliPath', () => {
  it('resolves an existing cli.js beside playwright-core', async () => {
    const { resolvePlaywrightCliPath } = await import('../src/downloader.ts')
    const path = resolvePlaywrightCliPath()
    expect(path.endsWith('cli.js')).toBe(true)
    expect(path).toContain('playwright-core')
  })
})

describe('downloadChromium', () => {
  it('forwards installer output lines and resolves on exit code 0', async () => {
    const child = new FakeChild()
    spawn.mockReturnValueOnce(child)
    const { downloadChromium } = await import('../src/downloader.ts')
    const lines: string[] = []
    const done = downloadChromium(line => lines.push(line))
    child.stdout.emit('data', Buffer.from('Downloading Chromium 50%\n'))
    child.stderr.emit('data', Buffer.from('warning: slow network\n'))
    child.emit('exit', 0)
    await expect(done).resolves.toBeUndefined()
    expect(lines).toEqual(['Downloading Chromium 50%', 'warning: slow network'])
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['install', 'chromium']),
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }),
    )
  })

  it('rejects naming the manual command on a non-zero exit', async () => {
    const child = new FakeChild()
    spawn.mockReturnValueOnce(child)
    const { downloadChromium, MANUAL_INSTALL_COMMAND } = await import('../src/downloader.ts')
    const done = downloadChromium(() => {})
    child.emit('exit', 1)
    await expect(done).rejects.toThrow(new RegExp(`Chromium download failed.*${MANUAL_INSTALL_COMMAND.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u'))
  })

  it('rejects naming the manual command when the installer cannot start', async () => {
    const child = new FakeChild()
    spawn.mockReturnValueOnce(child)
    const { downloadChromium, MANUAL_INSTALL_COMMAND } = await import('../src/downloader.ts')
    const done = downloadChromium(() => {})
    child.emit('error', new Error('spawn ENOENT'))
    await expect(done).rejects.toThrow(new RegExp(`failed to start.*spawn ENOENT.*${MANUAL_INSTALL_COMMAND.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'su'))
  })

  it('kills the child and rejects when the caller aborts', async () => {
    const child = new FakeChild()
    spawn.mockReturnValueOnce(child)
    const { downloadChromium } = await import('../src/downloader.ts')
    const abort = new AbortController()
    const done = downloadChromium(() => {}, abort.signal)
    abort.abort()
    await expect(done).rejects.toThrow('browser: Chromium download aborted')
    expect(child.killed).toBe(true)
  })
})
