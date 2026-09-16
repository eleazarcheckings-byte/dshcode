import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  classifyUpdate,
  compareVersions,
  FORBIDDEN_UPDATE_OWNER,
  githubLatestApiUrl,
  isAllowedReleaseUrl,
  parseAppUpdateYml,
  parseLatestYml,
  pinnedUpdateChannel,
  UPDATE_OWNER,
  UPDATE_REPO,
  updateDialogCopy,
  updateFeedUrl,
} from '../src/update-feed.ts'
import { checkForUpdates } from '../src/updater.ts'

const desktopRoot = dirname(fileURLToPath(new URL('.', import.meta.url)))

describe('update channel pin', () => {
  it('names eleazarcheckings-byte/dshcode and refuses whitelonng', () => {
    expect(pinnedUpdateChannel()).toEqual({ owner: UPDATE_OWNER, repo: UPDATE_REPO })
    expect(() => pinnedUpdateChannel({ owner: FORBIDDEN_UPDATE_OWNER, repo: 'dshcode' }))
      .toThrow('whitelonng/dshcode')
    expect(() => pinnedUpdateChannel({ owner: 'someone-else', repo: UPDATE_REPO }))
      .toThrow('someone-else')
  })

  it('points electron-updater feed URLs at the product fork', () => {
    expect(updateFeedUrl('win32')).toBe(
      'https://github.com/eleazarcheckings-byte/dshcode/releases/latest/download/latest.yml',
    )
    expect(updateFeedUrl('darwin')).toContain('latest-mac.yml')
    expect(updateFeedUrl('linux')).toContain('latest-linux.yml')
    expect(githubLatestApiUrl()).toBe(
      'https://api.github.com/repos/eleazarcheckings-byte/dshcode/releases/latest',
    )
    expect(updateFeedUrl('win32')).not.toContain('whitelonng')
  })

  it('parses the committed app-update.yml as the product fork', () => {
    const text = readFileSync(join(desktopRoot, 'app-update.yml'), 'utf8')
    expect(parseAppUpdateYml(text)).toEqual({ owner: UPDATE_OWNER, repo: UPDATE_REPO })
    expect(text).not.toMatch(/^owner:\s*whitelonng/mu)
    const builder = readFileSync(join(desktopRoot, 'electron-builder.yml'), 'utf8')
    expect(builder).toMatch(/owner:\s*eleazarcheckings-byte/u)
    expect(builder).toMatch(/repo:\s*dshcode/u)
    expect(builder).not.toMatch(/owner:\s*whitelonng/u)
    const manifest = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as {
      repository: { url: string }
    }
    expect(manifest.repository.url).toContain('eleazarcheckings-byte/dshcode')
    expect(manifest.repository.url).not.toContain('whitelonng')
  })

  it('refuses a generated feed that still names the third-party owner', () => {
    expect(() => parseAppUpdateYml('provider: github\nowner: whitelonng\nrepo: dshcode\n'))
      .toThrow('whitelonng')
  })
})

describe('latest.yml and version compare', () => {
  it('reads the electron-updater version field', () => {
    expect(parseLatestYml('version: 1.2.4\npath: Saturn-AI-1.2.4-win-x64.exe\n').version).toBe('1.2.4')
    expect(parseLatestYml("version: '1.2.4'\n").version).toBe('1.2.4')
    expect(() => parseLatestYml('path: only\n')).toThrow('no version')
  })

  it('compares dotted versions and strips v / desktop-v prefixes', () => {
    expect(compareVersions('1.2.2', '1.2.3')).toBe(-1)
    expect(compareVersions('1.2.3', 'v1.2.3')).toBe(0)
    expect(compareVersions('desktop-v1.2.4', '1.2.3')).toBe(1)
  })
})

describe('classifyUpdate', () => {
  const release = {
    tag_name: 'v1.2.4',
    html_url: 'https://github.com/eleazarcheckings-byte/dshcode/releases/tag/v1.2.4',
  }

  it('reports an available feed version without installing it', () => {
    const check = classifyUpdate({ current: '1.2.3', feedVersion: '1.2.4', release })
    expect(check).toEqual({
      status: 'available',
      current: '1.2.3',
      latest: '1.2.4',
      releaseUrl: release.html_url,
    })
    expect(updateDialogCopy(check).detail).toContain('does not install updates silently')
  })

  it('says the feed is empty when GitHub has no latest.yml and no newer tag', () => {
    expect(classifyUpdate({
      current: '1.2.3',
      feedVersion: undefined,
      release: { tag_name: 'v1.2.3', html_url: release.html_url },
    })).toEqual({ status: 'current', current: '1.2.3', feed: false })
    expect(classifyUpdate({ current: '1.2.3', feedVersion: undefined, release: undefined }))
      .toEqual({ status: 'empty', current: '1.2.3' })
    expect(updateDialogCopy({ status: 'current', current: '1.2.3', feed: false }).detail)
      .toContain('no auto-update feed')
    expect(updateDialogCopy({ status: 'empty', current: '1.2.3' }).message).toBe('No update feed yet')
  })

  it('names a newer GitHub installer when the electron-updater feed is unpublished', () => {
    expect(classifyUpdate({ current: '1.2.2', feedVersion: undefined, release })).toEqual({
      status: 'available-no-feed',
      current: '1.2.2',
      latest: 'v1.2.4',
      releaseUrl: release.html_url,
    })
  })

  it('treats a same-or-older feed as current', () => {
    expect(classifyUpdate({ current: '1.2.3', feedVersion: '1.2.3', release: undefined }))
      .toEqual({ status: 'current', current: '1.2.3', feed: true })
  })
})

describe('release URL allowlist', () => {
  it('opens only HTTPS GitHub URLs on the product fork', () => {
    expect(isAllowedReleaseUrl('https://github.com/eleazarcheckings-byte/dshcode/releases/tag/v1.2.3')).toBe(true)
    expect(isAllowedReleaseUrl('https://github.com/whitelonng/dshcode/releases/latest')).toBe(false)
    expect(isAllowedReleaseUrl('https://evil.example/download')).toBe(false)
    expect(isAllowedReleaseUrl('not a url')).toBe(false)
  })
})

describe('checkForUpdates', () => {
  it('classifies a 404 feed plus a newer GitHub tag as available-no-feed', async () => {
    const fetch = async (url: string) => {
      if (url.includes('/releases/latest/download/')) return { status: 404, text: 'Not Found' }
      return {
        status: 200,
        text: JSON.stringify({
          tag_name: 'v1.2.4',
          html_url: 'https://github.com/eleazarcheckings-byte/dshcode/releases/tag/v1.2.4',
        }),
      }
    }
    await expect(checkForUpdates({ current: '1.2.3', platform: 'win32', fetch })).resolves.toMatchObject({
      status: 'available-no-feed',
      latest: 'v1.2.4',
    })
  })

  it('classifies a 404 feed and 404 release as empty', async () => {
    const fetch = async () => ({ status: 404, text: 'Not Found' })
    await expect(checkForUpdates({ current: '1.2.3', platform: 'win32', fetch })).resolves.toEqual({
      status: 'empty',
      current: '1.2.3',
    })
  })

  it('surfaces a network failure instead of pretending the install is current', async () => {
    const fetch = async () => {
      throw new Error('offline')
    }
    await expect(checkForUpdates({ current: '1.2.3', platform: 'win32', fetch })).resolves.toEqual({
      status: 'error',
      current: '1.2.3',
      message: 'offline',
    })
    expect(updateDialogCopy({ status: 'error', current: '1.2.3', message: 'offline' }).detail).toBe('offline')
  })

  it('surfaces a feed HTTP error instead of pretending the install is current', async () => {
    const fetch = async () => ({ status: 500, text: 'nope' })
    await expect(checkForUpdates({ current: '1.2.3', platform: 'win32', fetch })).resolves.toMatchObject({
      status: 'error',
      message: 'update feed HTTP 500',
    })
  })

  it('rejects a malformed GitHub latest payload', async () => {
    const fetch = async (url: string) => {
      if (url.includes('/download/')) return { status: 404, text: 'Not Found' }
      return { status: 200, text: '{"nope":true}' }
    }
    await expect(checkForUpdates({ current: '1.2.3', platform: 'win32', fetch })).resolves.toMatchObject({
      status: 'error',
      message: 'GitHub latest release payload is malformed',
    })
  })

  it('falls back to the product latest URL when a release link is not on the fork', () => {
    const check = classifyUpdate({
      current: '1.2.2',
      feedVersion: '1.2.4',
      release: { tag_name: 'v1.2.4', html_url: 'https://evil.example/download' },
    })
    expect(check.status).toBe('available')
    if (check.status === 'available') {
      expect(check.releaseUrl).toBe('https://github.com/eleazarcheckings-byte/dshcode/releases/latest')
    }
    const noFeed = classifyUpdate({
      current: '1.2.2',
      feedVersion: undefined,
      release: { tag_name: 'v1.2.4', html_url: 'https://evil.example/download' },
    })
    expect(noFeed.status).toBe('available-no-feed')
    if (noFeed.status === 'available-no-feed') {
      expect(noFeed.releaseUrl).toBe('https://github.com/eleazarcheckings-byte/dshcode/releases/latest')
    }
    expect(updateDialogCopy(noFeed).message).toContain('newer installer')
    expect(updateDialogCopy({ status: 'current', current: '1.2.3', feed: true }).detail)
      .toContain('No newer version')
    expect(updateDialogCopy({
      status: 'available',
      current: '1.2.3',
      latest: '1.3.0',
      releaseUrl: 'https://github.com/eleazarcheckings-byte/dshcode/releases/latest',
    }).openRelease).toContain('eleazarcheckings-byte')
  })

  it('reads an electron-updater feed when GitHub publishes latest.yml', async () => {
    const fetch = async (url: string) => {
      if (url.endsWith('latest.yml')) return { status: 200, text: 'version: 1.3.0\n' }
      return {
        status: 200,
        text: JSON.stringify({
          tag_name: 'v1.3.0',
          html_url: 'https://github.com/eleazarcheckings-byte/dshcode/releases/tag/v1.3.0',
        }),
      }
    }
    await expect(checkForUpdates({ current: '1.2.3', platform: 'win32', fetch })).resolves.toMatchObject({
      status: 'available',
      latest: '1.3.0',
    })
  })

  it('treats an empty latest.yml body as a missing feed', async () => {
    const fetch = async (url: string) => {
      if (url.includes('/download/')) return { status: 200, text: '  \n' }
      return { status: 404, text: 'Not Found' }
    }
    await expect(checkForUpdates({ current: '1.2.3', platform: 'win32', fetch })).resolves.toEqual({
      status: 'empty',
      current: '1.2.3',
    })
  })

  it('surfaces a GitHub API error after a missing feed', async () => {
    const fetch = async (url: string) => {
      if (url.includes('/download/')) return { status: 404, text: 'Not Found' }
      return { status: 503, text: 'down' }
    }
    await expect(checkForUpdates({ current: '1.2.3', platform: 'win32', fetch })).resolves.toMatchObject({
      status: 'error',
      message: 'GitHub releases HTTP 503',
    })
  })

  it('rejects an app-update.yml that is not a GitHub provider', () => {
    expect(() => parseAppUpdateYml('provider: generic\nowner: eleazarcheckings-byte\nrepo: dshcode\n'))
      .toThrow('github')
    expect(() => parseAppUpdateYml('provider: github\n')).toThrow('owner or repo')
  })
})
