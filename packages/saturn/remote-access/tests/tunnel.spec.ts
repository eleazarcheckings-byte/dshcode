/**
 * Tunnel mode is opt-in and bring-your-own-binary: the host locates an already
 * installed cloudflared on PATH and never fetches one. These cases pin the
 * lookup, the URL harvest, and the refusal when the binary is absent.
 */

import { describe, expect, it, vi } from 'vitest'
import { findCloudflared, harvestTunnelUrl, tunnelArguments } from '../src/tunnel.ts'

describe('cloudflared lookup', () => {
  it('returns the first PATH entry that actually holds the binary', () => {
    const exists = vi.fn((path: string) => path === '/opt/bin/cloudflared')
    expect(findCloudflared({ pathValue: '/usr/bin:/opt/bin', platform: 'linux', exists }))
      .toBe('/opt/bin/cloudflared')
    expect(exists).toHaveBeenCalledWith('/usr/bin/cloudflared')
  })

  it('tries the Windows executable extensions on win32', () => {
    const exists = vi.fn((path: string) => path === 'C:\\tools\\cloudflared.exe')
    expect(findCloudflared({ pathValue: 'C:\\tools', platform: 'win32', exists }))
      .toBe('C:\\tools\\cloudflared.exe')
  })

  it('reports absence instead of reaching for a download', () => {
    const exists = vi.fn(() => false)
    expect(findCloudflared({ pathValue: '/usr/bin', platform: 'linux', exists })).toBeUndefined()
    expect(findCloudflared({ pathValue: undefined, platform: 'linux', exists })).toBeUndefined()
    expect(findCloudflared({ pathValue: '', platform: 'linux', exists })).toBeUndefined()
  })
})

describe('tunnel output', () => {
  it('harvests the published hostname out of the noise cloudflared prints', () => {
    const log = [
      '2026-09-15T10:00:00Z INF Thank you for trying Cloudflare Tunnel.',
      '2026-09-15T10:00:01Z INF |  https://calm-ring-verdict-18.trycloudflare.com  |',
      '2026-09-15T10:00:02Z INF Registered tunnel connection',
    ].join('\n')
    expect(harvestTunnelUrl(log)).toBe('https://calm-ring-verdict-18.trycloudflare.com')
  })

  it('ignores lines that carry no published hostname', () => {
    expect(harvestTunnelUrl('INF Requesting new quick Tunnel on trycloudflare.com...')).toBeUndefined()
    expect(harvestTunnelUrl('')).toBeUndefined()
    expect(harvestTunnelUrl('https://example.com/not-a-tunnel')).toBeUndefined()
  })

  it('points the tunnel at the loopback proxy and nothing else', () => {
    expect(tunnelArguments(41234)).toEqual(['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:41234'])
  })
})
