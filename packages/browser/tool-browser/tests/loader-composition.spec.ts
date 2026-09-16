import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolBrowser from '../src/index.ts'

const { launch } = vi.hoisted(() => ({
  launch: vi.fn((_options?: unknown): Promise<unknown> => {
    return Promise.reject(new Error('playwright launch mock not configured'))
  }),
}))
let href = 'about:blank'

vi.mock('playwright-core', () => ({
  chromium: {
    launch: (options?: unknown): Promise<unknown> => launch(options),
  },
}))

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  launch.mockReset()
  href = 'about:blank'
})

/**
 * Boot a cordis.yml carrying the given browser-tool config block.
 * @param configLines - YAML lines nested under the tool's `config:` key.
 * @returns the booted context.
 */
async function boot(configLines: readonly string[]): Promise<Context> {
  launch.mockResolvedValue({
    newPage: async () => ({
      goto: async (url: string) => {
        href = url
      },
      url: () => href,
      title: async () => 'Composed',
      locator: (selector: string) => selector === 'html'
        ? { ariaSnapshot: async () => '- heading "Composed"' }
        : { innerText: async () => 'body text' },
      screenshot: async () => Buffer.from('png'),
      keyboard: { press: async () => {} },
      evaluate: async () => {},
      on: () => {},
      close: async () => {},
    }),
    close: async () => {},
  })
  root = await mkdtemp(join(tmpdir(), 'dsh-tool-browser-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-tool-browser'",
    ...configLines.length > 0 ? ['  config:', ...configLines] : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = `${pathToFileURL(root).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-tool-browser', ToolBrowser],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

describe('browser tool real Loader composition through cordis.yml', () => {
  it('boots default config and navigates end to end', async () => {
    const ctx = await boot([])
    const schema = ctx.tools.schemas().find(item => item.name === 'browser_navigate')
    expect(schema).toBeDefined()

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('loader-browser-call'),
      name: 'browser_navigate',
      arguments: { url: 'https://example.com/' },
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected browser_navigate success')
    expect(result.value).toEqual({ url: 'https://example.com/', title: 'Composed' })
    expect(launch).toHaveBeenCalledWith({ headless: true })
  }, 30_000)

  it('forwards executablePath from the composition entry', async () => {
    const ctx = await boot(['    executablePath: /opt/chrome', '    headless: false'])
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('loader-browser-binary'),
      name: 'browser_navigate',
      arguments: { url: 'http://127.0.0.1/' },
    })
    expect(result.isError).toBe(false)
    expect(launch).toHaveBeenCalledWith({ headless: false, executablePath: '/opt/chrome' })
  }, 30_000)

  it('fails loading when timeoutMs is invalid', async () => {
    await expect(boot(['    timeoutMs: 0'])).rejects.toThrow('browser: timeoutMs must be a positive safe integer')
  }, 30_000)
})
