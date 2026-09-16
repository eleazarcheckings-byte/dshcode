/**
 * Model-facing browser verify tools. `browser_navigate` opens one shared http(s)
 * tab through in-tree Playwright Chromium; `browser_snapshot` returns that tab's
 * accessibility tree and, optionally, a PNG path. Chromium starts on the first
 * navigation so load and schema harvest do not launch a browser.
 * @module @deepseek-ai/dsh-tool-browser
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { launchPlaywright } from './playwright.ts'
import type { PlaywrightLaunchSpec } from './playwright.ts'
import { BrowserSession } from './session.ts'
import type { SnapshotValue } from './session.ts'
import { parseBrowserUrl } from './urls.ts'

export { parseBrowserUrl }

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-browser'

/** Services required by the browser verify tools. */
export const inject = ['tools']

/** Default cooperative timeout budget (ms) for navigate and snapshot. */
export const DEFAULT_TIMEOUT_MS = 30_000
/** Default character cap on one accessibility snapshot, including truncation footer. */
export const DEFAULT_SNAPSHOT_MAX_CHARS = 50_000
/** Default byte cap on one PNG screenshot. */
export const DEFAULT_SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024

/** Deployment configuration for the browser verify tools. */
export interface Config {
  /** Launch Chromium headless. Defaults to true. */
  headless?: boolean
  /** Cooperative timeout budget (ms) for both tools. Defaults to 30000. */
  timeoutMs?: number
  /** Absolute Chromium/Chrome/Edge binary, when the deployment pins one. */
  executablePath?: string
  /** Playwright browser channel (`chrome`, `msedge`, `chromium`, …), when set. */
  channel?: string
  /** Character cap on one accessibility tree. Defaults to 50000. */
  snapshotMaxChars?: number
  /** Byte cap on one PNG screenshot. Defaults to 2097152. */
  screenshotMaxBytes?: number
  /** Directory for exclusive PNG writes; defaults to a private directory under os.tmpdir(). */
  screenshotDir?: string
}

/** Schemastery configuration for the browser verify tools. */
export const Config: z<Config> = z.object({
  headless: z.boolean().default(true),
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  executablePath: z.string().required(false),
  channel: z.string().required(false),
  snapshotMaxChars: z.number().default(DEFAULT_SNAPSHOT_MAX_CHARS),
  screenshotMaxBytes: z.number().default(DEFAULT_SCREENSHOT_MAX_BYTES),
  screenshotDir: z.string().required(false),
})

/** Config after defaults and beyond-schema constraints are applied. */
export interface ResolvedConfig {
  headless: boolean
  timeoutMs: number
  executablePath?: string
  channel?: string
  snapshotMaxChars: number
  screenshotMaxBytes: number
  screenshotDir: string
}

/**
 * Resolve raw config into validated launch and cap facts. Programmatic
 * construction may bypass Schemastery normalization, so every default and bound
 * is re-judged here; the composition entry calls this at load so misconfiguration
 * fails loud.
 * @param config - raw plugin config.
 * @returns validated facts.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const headless = config.headless ?? true
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const snapshotMaxChars = config.snapshotMaxChars ?? DEFAULT_SNAPSHOT_MAX_CHARS
  const screenshotMaxBytes = config.screenshotMaxBytes ?? DEFAULT_SCREENSHOT_MAX_BYTES
  for (const [field, value] of [
    ['timeoutMs', timeoutMs],
    ['snapshotMaxChars', snapshotMaxChars],
    ['screenshotMaxBytes', screenshotMaxBytes],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`browser: ${field} must be a positive safe integer`)
    }
  }
  const executablePath = optionalNonEmpty(config.executablePath, 'executablePath')
  const channel = optionalNonEmpty(config.channel, 'channel')
  const screenshotDir = optionalNonEmpty(config.screenshotDir, 'screenshotDir')
    ?? join(tmpdir(), 'dsh-browser-screenshots')
  return {
    headless,
    timeoutMs,
    ...executablePath === undefined ? {} : { executablePath },
    ...channel === undefined ? {} : { channel },
    snapshotMaxChars,
    screenshotMaxBytes,
    screenshotDir,
  }
}

/**
 * Reject an empty optional string and leave an unset field absent.
 * @param value - raw config string.
 * @param field - config field name for the error.
 * @returns the trimmed string, or undefined when the field was omitted.
 */
function optionalNonEmpty(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error(`browser: ${field} must be non-empty when set`)
  return trimmed
}

/** Validated `browser_navigate` arguments. */
export interface NavigateArgs {
  url: string
}

/** Validated `browser_snapshot` arguments. */
export interface SnapshotArgs {
  screenshot?: boolean
}

/**
 * Pending navigate card titled by the requested URL.
 * @param args - validated navigate arguments.
 * @returns the generic fetch card.
 */
export function presentNavigateCall(args: NavigateArgs): GenericCallView {
  return { card: 'generic', title: args.url, kind: 'fetch', rawInput: args.url }
}

/**
 * Pending snapshot card.
 * @param args - validated snapshot arguments.
 * @returns the generic read card.
 */
export function presentSnapshotCall(args: SnapshotArgs): GenericCallView {
  return { card: 'generic', title: 'Page snapshot', kind: 'read', rawInput: args }
}

/**
 * Render a navigation outcome as model-facing text.
 * @param _args - unused validated arguments.
 * @param value - canonical navigate value.
 * @returns one text block.
 */
export function renderNavigate(_args: NavigateArgs, value: { url: string; title: string }): { type: 'text'; text: string }[] {
  const title = value.title.trim()
  return [{ type: 'text', text: title.length === 0 ? `Navigated to ${value.url}` : `Navigated to ${value.url}\n${title}` }]
}

/**
 * Render an accessibility snapshot as model-facing text.
 * @param _args - unused validated arguments.
 * @param value - canonical snapshot value.
 * @returns one text block.
 */
export function renderSnapshot(_args: SnapshotArgs, value: SnapshotValue): { type: 'text'; text: string }[] {
  const title = value.title.trim()
  const header = title.length === 0 ? value.url : `${value.url}\n${title}`
  const screenshot = value.screenshotPath === undefined ? '' : `\nScreenshot: ${value.screenshotPath}`
  return [{ type: 'text', text: `${header}\n${value.snapshot}${screenshot}` }]
}

const NAVIGATE_DESCRIPTION =
  'Open one http(s) URL in a shared headless browser tab and wait until the document is loaded. '
  + 'Use before browser_snapshot to inspect a page you just changed or a public URL. '
  + 'Only http and https are accepted; file URLs, data URLs, and URLs with user credentials are rejected. '
  + 'The tab is reused across calls in this session — each navigate replaces the previous page.'

const SNAPSHOT_DESCRIPTION =
  'Capture the current browser tab as an accessibility tree (Playwright ARIA snapshot). '
  + 'Call browser_navigate first. Set screenshot to true to also write a PNG and return its path; '
  + 'the image bytes themselves are not returned. Use this to verify rendered UI, not to search or fetch documents — those are web_search and web_fetch.'

const NAVIGATE_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    url: { type: 'string', required: true },
    title: { type: 'string', required: true },
  },
} as const

const SNAPSHOT_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    url: { type: 'string', required: true },
    title: { type: 'string', required: true },
    snapshot: { type: 'string', required: true },
    truncated: { type: 'boolean', required: true },
    screenshotPath: { type: 'string' },
  },
} as const

/**
 * Register `browser_navigate` and `browser_snapshot` on `ctx.tools`. Chromium
 * launches on the first navigate; disposing the plugin fiber closes it.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment configuration, validated at load.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const launchSpec: PlaywrightLaunchSpec = {
    headless: resolved.headless,
    ...resolved.executablePath === undefined ? {} : { executablePath: resolved.executablePath },
    ...resolved.channel === undefined ? {} : { channel: resolved.channel },
  }
  const session = new BrowserSession(() => launchPlaywright(launchSpec))
  ctx.effect(() => () => session.dispose())
  ctx.tools.register(defineTool({
    name: 'browser_navigate',
    description: NAVIGATE_DESCRIPTION,
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => false,
    parameters: {
      url: {
        type: 'string',
        required: true,
        description: 'Absolute http(s) URL to open in the shared browser tab.',
      },
    },
    output: {
      schema: NAVIGATE_OUTPUT,
      render: renderNavigate,
    },
    async execute(args, exec) {
      const url = parseBrowserUrl(args.url)
      return await session.navigate(url, resolved.timeoutMs, exec.signal)
    },
    presentCall: presentNavigateCall,
  }))
  ctx.tools.register(defineTool({
    name: 'browser_snapshot',
    description: SNAPSHOT_DESCRIPTION,
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => false,
    parameters: {
      screenshot: {
        type: 'boolean',
        description: 'When true, also write a PNG of the current page and return screenshotPath.',
      },
    },
    output: {
      schema: SNAPSHOT_OUTPUT,
      render: renderSnapshot,
    },
    async execute(args, exec) {
      return await session.snapshot({
        screenshot: args.screenshot === true,
        maxChars: resolved.snapshotMaxChars,
        screenshotMaxBytes: resolved.screenshotMaxBytes,
        screenshotDir: resolved.screenshotDir,
      }, exec.signal)
    },
    presentCall: presentSnapshotCall,
  }))
}
