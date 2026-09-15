/**
 * A pinning TLS client for the composition suite: it trusts nothing but the
 * SHA-256 the pairing payload published, which is exactly the check the phone
 * performs. Node's global fetch cannot express that, so these helpers speak
 * node:https directly.
 */

import { request as httpsRequest, type RequestOptions } from 'node:https'
import type { IncomingMessage } from 'node:http'

/** One completed pinned response. */
export interface PinnedResponse {
  status: number
  headers: IncomingMessage['headers']
  body: string
}

function pinned(fingerprintSha256: string): RequestOptions['checkServerIdentity'] {
  return (_host, certificate) => {
    const actual = certificate.fingerprint256.replaceAll(':', '').toLowerCase()
    return actual === fingerprintSha256
      ? undefined
      : new Error(`remote certificate ${actual} is not the pinned ${fingerprintSha256}`)
  }
}

/** Issue one request against the pinned host and read the whole body. */
export async function pinnedRequest(options: {
  url: string
  fingerprint: string
  method?: string
  headers?: Record<string, string>
  body?: string
}): Promise<PinnedResponse> {
  const target = new URL(options.url)
  return await new Promise<PinnedResponse>((resolve, reject) => {
    const req = httpsRequest({
      host: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
      rejectUnauthorized: false,
      checkServerIdentity: pinned(options.fingerprint),
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    req.on('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

/** A held-open event stream whose frames can be awaited one at a time. */
export interface PinnedStream {
  status: number
  headers: IncomingMessage['headers']
  next(): Promise<string>
  close(): void
}

/** Open a pinned Server-Sent Events stream and buffer complete frames. */
export async function pinnedStream(options: {
  url: string
  fingerprint: string
  headers?: Record<string, string>
}): Promise<PinnedStream> {
  const target = new URL(options.url)
  return await new Promise<PinnedStream>((resolve, reject) => {
    const req = httpsRequest({
      host: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'GET',
      headers: { accept: 'text/event-stream', ...options.headers },
      rejectUnauthorized: false,
      checkServerIdentity: pinned(options.fingerprint),
    }, (res) => {
      const frames: string[] = []
      const waiters: ((frame: string) => void)[] = []
      let buffer = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => {
        buffer += chunk
        let at = buffer.indexOf('\n\n')
        while (at !== -1) {
          const frame = buffer.slice(0, at)
          buffer = buffer.slice(at + 2)
          const waiter = waiters.shift()
          if (waiter === undefined) frames.push(frame)
          else waiter(frame)
          at = buffer.indexOf('\n\n')
        }
      })
      resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        next: () => new Promise<string>((settle) => {
          const ready = frames.shift()
          if (ready !== undefined) settle(ready)
          else waiters.push(settle)
        }),
        close: () => { req.destroy() },
      })
    })
    req.on('error', reject)
    req.end()
  })
}

/** Read one `data:` payload out of an SSE frame, ignoring comments. */
export function frameData(frame: string): unknown {
  const line = frame.split('\n').find(entry => entry.startsWith('data:'))
  if (line === undefined) throw new Error(`frame carries no data line: ${JSON.stringify(frame)}`)
  return JSON.parse(line.slice('data:'.length).trim())
}
