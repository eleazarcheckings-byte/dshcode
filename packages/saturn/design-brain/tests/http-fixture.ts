/** A keyless protocol server used through the production MCP adapter. */
import { createServer } from 'node:http'
import type { Socket } from 'node:net'

export async function startBrainFixture() {
  let mode: 'ready' | 'partial' | 'fail' | 'hang' | 'hang-initialized' | 'hang-list' = 'ready'
  let requests = 0
  const calls: string[] = []
  const sockets = new Set<Socket>()
  const server = createServer((request, response) => {
    void (async () => {
      requests++
      if (mode === 'hang') return
      if (mode === 'fail') { response.writeHead(503).end(); return }
      if (request.method !== 'POST') { response.writeHead(405).end(); return }
      let body = ''
      for await (const part of request) body += String(part)
      const data = JSON.parse(body) as { id?: number; method: string; params?: { name?: string } }
      if (mode === 'hang-initialized' && data.method === 'notifications/initialized' || mode === 'hang-list' && data.method === 'tools/list') return
      if (data.id === undefined) { response.writeHead(202).end(); return }
      const result = data.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'design-brain-fixture', version: '1.0.0' } }
        : data.method === 'tools/list'
          ? { tools: (mode === 'partial' ? ['compose'] : ['compose', 'review']).map(name => ({ name, description: `${name} fixture`, inputSchema: { type: 'object', properties: {} } })) }
          : { content: [{ type: 'text', text: `Executed ${data.params?.name ?? 'unknown'}` }] }
      if (data.method === 'tools/call') calls.push(data.params?.name ?? 'unknown')
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: data.id, result }))
    })().catch(() => { if (!response.headersSent) response.writeHead(500).end() })
  })
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('No fixture port')
  return {
    url: `http://127.0.0.1:${address.port}/mcp`, calls,
    get requests() { return requests },
    set mode(value: typeof mode) { mode = value },
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) => server.close((error) => { if (error === undefined) resolve(); else reject(error) }))
    },
  }
}
