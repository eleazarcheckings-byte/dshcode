/**
 * Tunnel mode, bring your own binary. The harness spawns a cloudflared that is
 * already on PATH and harvests the address it prints; it never fetches one,
 * because downloading and executing a network binary on a person's machine is
 * their decision, not the agent's. When nothing is installed the Settings card
 * says where to get it and stops.
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'

/** Where to look for cloudflared and how to decide a candidate exists. */
export interface CloudflaredLookup {
  /** The PATH value to search, usually `process.env.PATH`. */
  pathValue: string | undefined
  /** The platform, which decides the executable suffixes. */
  platform: string
  /** Existence probe; injected so the lookup stays a pure function under test. */
  exists: (path: string) => boolean
}

const TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/u

/**
 * Locate an installed cloudflared.
 * @param lookup - the PATH to search, the platform, and the existence probe.
 * @returns the absolute path of the first candidate that exists, or undefined.
 */
export function findCloudflared(lookup: CloudflaredLookup): string | undefined {
  if (lookup.pathValue === undefined || lookup.pathValue === '') return undefined
  // The platform is a parameter, so its path grammar must be too: a PATH is
  // semicolon-separated and backslash-joined on Windows, colon and slash
  // elsewhere, regardless of the host this code happens to run on.
  const windows = lookup.platform === 'win32'
  const names = windows ? ['cloudflared.exe', 'cloudflared.cmd', 'cloudflared'] : ['cloudflared']
  for (const directory of lookup.pathValue.split(windows ? ';' : ':')) {
    if (directory === '') continue
    for (const name of names) {
      const candidate = (windows ? win32 : posix).join(directory, name)
      if (lookup.exists(candidate)) return candidate
    }
  }
  return undefined
}

/** The lookup bound to this process, for callers with nothing to inject. */
export function findInstalledCloudflared(): string | undefined {
  return findCloudflared({ pathValue: process.env.PATH, platform: process.platform, exists: existsSync })
}

/**
 * Read the published hostname out of cloudflared's output.
 * @param output - everything printed so far, on either stream.
 * @returns the tunnel origin, or undefined while none has been printed.
 */
export function harvestTunnelUrl(output: string): string | undefined {
  return TUNNEL_URL_PATTERN.exec(output)?.[0]
}

/**
 * The exact argument vector: a quick tunnel onto the loopback proxy, nothing else.
 * @param port - the loopback port the proxy is listening on.
 * @returns the arguments to pass to cloudflared.
 */
export function tunnelArguments(port: number): string[] {
  return ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${String(port)}`]
}

/** A running quick tunnel. */
export interface TunnelHandle {
  /** The published origin. */
  url: string
  /** Stop the tunnel. */
  stop: () => Promise<void>
}

/**
 * Start a quick tunnel and wait for the address it publishes.
 * @param options - the binary, the loopback port, and how long to wait.
 * @returns the handle, or undefined when no address was published in time.
 */
export async function startTunnel(options: {
  binary: string
  port: number
  timeoutMs: number
  onOutput?: (line: string) => void
}): Promise<TunnelHandle | undefined> {
  let child: ChildProcessByStdio<null, Readable, Readable>
  try {
    child = spawn(options.binary, tunnelArguments(options.port), { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    return undefined
  }
  const stop = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>((resolve) => {
      child.once('close', () => { resolve() })
      child.kill()
      // A tunnel that ignores the signal must not hold the host open.
      setTimeout(() => { child.kill('SIGKILL'); resolve() }, 2000).unref()
    })
  }
  const url = await new Promise<string | undefined>((resolve) => {
    let seen = ''
    const timer = setTimeout(() => { resolve(undefined) }, options.timeoutMs)
    timer.unref()
    const read = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      options.onOutput?.(text)
      seen += text
      const found = harvestTunnelUrl(seen)
      if (found === undefined) return
      clearTimeout(timer)
      resolve(found)
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.once('error', () => { clearTimeout(timer); resolve(undefined) })
    child.once('close', () => { clearTimeout(timer); resolve(harvestTunnelUrl(seen)) })
  })
  if (url === undefined) {
    await stop()
    return undefined
  }
  return { url, stop }
}
