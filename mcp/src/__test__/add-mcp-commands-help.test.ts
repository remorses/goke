// First-run help and stale-cache behavior for addMcpCommands.
import http from 'node:http'
import { describe, expect, it } from 'vitest'
import { goke } from 'goke'
import { addMcpCommands, type CachedMcpTools } from '../index.js'

const staleCache = (over: Partial<CachedMcpTools> = {}): CachedMcpTools => ({
  tools: [
    {
      name: 'find_bookmarks',
      description: 'Find bookmarks',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
  timestamp: Date.now() - 2 * 60 * 60 * 1000,
  sessionId: 'stale-session',
  ...over,
})

function captureErrors() {
  const errors: string[] = []
  const error = console.error
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '))
  }
  return {
    errors,
    restore() {
      console.error = error
    },
  }
}

function listen401() {
  const server = http.createServer((_req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'unauthorized' }))
  })
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') throw new Error('no port')
      resolve({
        url: `http://127.0.0.1:${addr.port}/mcp`,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

describe('addMcpCommands first-run help', () => {
  it('lets --help run when there is no token and no cache', async () => {
    const io = captureErrors()
    const cli = goke('testcli')
    cli.command('config', 'Save token').action(() => {})

    try {
      await addMcpCommands({
        cli,
        argv: ['--help'],
        getMcpTransport: () => null,
        loadCache: () => undefined,
        saveCache: () => {},
      })
    } finally {
      io.restore()
    }

    const help = cli.helpText()
    expect(io.errors.join('\n')).not.toMatch(/Failed to connect/)
    expect(help).toMatch(/config/)
    expect(help).not.toMatch(/find_bookmarks/)
  })

  it('registers stale cached tools when live fetch is impossible', async () => {
    const cli = goke('testcli')

    await addMcpCommands({
      cli,
      argv: ['--help'],
      getMcpTransport: () => null,
      loadCache: () => staleCache(),
      saveCache: () => {},
    })

    expect(cli.helpText()).toMatch(/find_bookmarks/)
  })

  it('does not start OAuth when --help gets a 401', async () => {
    const server = await listen401()
    const authUrls: string[] = []
    const io = captureErrors()
    const cli = goke('testcli')

    try {
      await addMcpCommands({
        cli,
        argv: ['--help'],
        getMcpUrl: () => server.url,
        oauth: {
          clientName: 'test',
          load: () => undefined,
          save: () => {},
          onAuthUrl: (url) => {
            authUrls.push(url)
          },
        },
        loadCache: () => undefined,
        saveCache: () => {},
      })
    } finally {
      io.restore()
      await server.close()
    }

    expect(authUrls).toEqual([])
    expect(io.errors.join('\n')).not.toMatch(/Authentication required/)
    expect(cli.helpText()).toMatch(/Usage/)
  })

  it('does not connect for an already registered command', async () => {
    let transportCalls = 0
    const cli = goke('testcli')
    cli.command('config', 'Save token').action(() => {})

    await addMcpCommands({
      cli,
      argv: ['config', '--token', 'x'],
      getMcpTransport: () => {
        transportCalls += 1
        return null
      },
      loadCache: () => undefined,
      saveCache: () => {},
    })

    expect(transportCalls).toBe(0)
  })
})
