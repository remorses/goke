# @goke/mcp

## 0.0.13

1. **Skip live discovery** for `--help`, no-args, completions, and already registered commands such as `config`. Those must not open OAuth or hit the MCP server.
2. **Expired cache no longer reuses `sessionId`.** Stale tool schemas still appear in help.
3. **`argv` option** so callers can pass the same args they will parse, instead of only `process.argv`.

## 0.0.12

1. **`--help` / no-args never start OAuth** and no longer print a connect error when the MCP server needs auth. First-run help can show the CLI's own `config` command.
2. **Expired cache is reused** when a live `tools/list` is impossible (no token, or 401 on help).
3. **`getHeaders()`** sends extra HTTP headers with `getMcpUrl` (Bearer tokens). Use `getMcpTransport` for stdio or custom transports.

## 0.0.10

1. **Fixed: command actions now receive the injected `GokeExecutionContext` as the third argument** — previously `runCliTool` invoked actions as `action(...positionals, options)`, silently dropping the `ctx` argument that `cli.parse()` always passes. Actions using `ctx.fs`, `ctx.process.cwd`, `ctx.process.env`, `ctx.process.stdin`, or `ctx.console.log` now receive real values instead of `undefined`:

   ```ts
   cli.command('read <file>', 'Read a file')
     .action(async (file, _options, ctx) => {
       // ctx was undefined before — now it works:
       const text = await ctx.fs.readFile(
         `${ctx.process.cwd}/${file}`, 'utf8',
       )
       ctx.console.log(`Read ${text.length} bytes`)
       return { text, env: ctx.process.env.NODE_ENV }
     })
   ```

2. **`ctx.console.*` and `ctx.process.stdout/stderr` output is now captured into `CallToolResult.content`** — writes to the injected context streams no longer leak into the host process's real stdio. For the stdio MCP transport this prevents corruption of the JSON-RPC channel. Captured stdout appears as the first content block, captured stderr as the second, followed by the action's return value as a stringified block:

   ```ts
   .action((_options, ctx) => {
     ctx.console.log('fetching...')
     ctx.console.error('warn: rate limit low')
     return { count: 42 }
   })
   // → content: [
   //     { type: 'text', text: 'fetching...\n' },
   //     { type: 'text', text: 'warn: rate limit low\n' },
   //     { type: 'text', text: '{ "count": 42 }' },
   //   ]
   ```

   Actions returning a ready-made `{ content: [...] }` object still bypass capture merging — that remains the escape hatch for full manual control.

3. **`ctx.process.exit(code)` no longer kills the MCP server** — calling `ctx.process.exit(1)` (or any non-zero code) in an action now throws `GokeProcessExit` internally, which `runCliTool` catches and converts to `{ isError: true, content: [captured output] }`. The host process stays alive and subsequent tool calls keep serving. `exit(0)` resolves as a normal success result with whatever was captured:

   ```ts
   .action((_options, ctx) => {
     ctx.console.error('authentication failed')
     ctx.process.exit(1)  // used to kill the server — now safe
   })
   // → { isError: true, content: [{ type: 'text', text: 'authentication failed\n' }] }
   ```

4. **Multi-tenant remote MCP via `WebStandardStreamableHTTPServerTransport`** — the `(Request) → Response` shape plugs directly into Spiceflow, Cloudflare Workers, Deno, Bun, or Next.js. Clone the base cli per session with per-tenant `{ cwd, env, fs }`:

   ```ts
   import { Spiceflow } from 'spiceflow'
   import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

   const baseCli = buildCli()   // define commands once
   const transports = new Map()

   async function handleMcpRequest(request: Request): Promise<Response> {
     let parsedBody: unknown
     if (request.method === 'POST') {
       parsedBody = await request.clone().json().catch(() => undefined)
     }

     const sessionId = request.headers.get('mcp-session-id')
     if (sessionId && transports.has(sessionId)) {
       return transports.get(sessionId).handleRequest(request, { parsedBody })
     }

     if (!isInitializeRequest(parsedBody)) {
       return Response.json({ error: 'No valid session ID' }, { status: 400 })
     }

     const tenantId = request.headers.get('x-tenant-id')!
     const tenant = resolveTenant(tenantId)

     // Each session gets an isolated cli clone — ctx.fs, ctx.process.cwd,
     // ctx.process.env all point to that tenant's data, never another's.
     const tenantCli = baseCli.clone({ cwd: tenant.cwd, env: tenant.env, fs: tenant.fs })
     const server = new McpLowLevelServer({ name: 'my-mcp', version: '1.0.0' }, { capabilities: {} })
     addCliToolsToMcp({ cli: tenantCli, server })

     const transport = new WebStandardStreamableHTTPServerTransport({
       sessionIdGenerator: () => randomUUID(),
       enableJsonResponse: true,
       onsessioninitialized: sid => transports.set(sid, transport),
       onsessionclosed: sid => transports.delete(sid),
     })
     await server.connect(transport)
     return transport.handleRequest(request, { parsedBody })
   }

   new Spiceflow()
     .route({ method: '*', path: '/mcp', handler: ({ request }) => handleMcpRequest(request) })
     .listen(3000)
   ```

   See the new "Multi-tenant remote MCP over HTTP" section in the README for the full pattern and framework mounting snippets.

## 0.0.9

1. **New `createMcpAction()`** — turn any goke CLI into a stdio MCP server with one line. Add a command to your CLI and every other command is automatically exposed as an MCP tool:

   ```ts
   import { createMcpAction } from '@goke/mcp'

   const cli = goke('my-cli')

   cli.command('search', 'Search pages')
     .option('--query <query>', z.string().describe('Search query'))
     .action((options) => findPages(options.query))

   // Running `my-cli mcp` starts a stdio MCP server
   cli.command('mcp', 'Start MCP server over stdio')
     .action(createMcpAction({ cli }))
   ```

   The `mcp` command itself is automatically excluded from the tool list. Options with Zod schemas (or any Standard Schema) become typed `inputSchema` properties. Accepts the same filtering options as `addCliToolsToMcp`: `commandFilter`, `sanitizeToolName`, `serverName`, `serverVersion`, and `createTransport` for custom transports.

   Install it in any MCP client with [`@playwriter/install-mcp`](https://github.com/nicepkg/install-mcp):
   ```bash
   npx @playwriter/install-mcp my-cli --client claude-desktop
   npx @playwriter/install-mcp my-cli --client cursor
   ```

## 0.0.8

1. **Added `./src` and `./src/*` exports** — import directly from source TypeScript files without going through `dist`.
2. **Added package metadata** — `homepage`, `bugs`, `repository.directory`, and expanded `keywords` for better discoverability on npm.

## 0.0.7

1. **Fixed: test files excluded from published package** — `dist/test/` is no longer included in the npm tarball.

## 0.0.6

1. **Added `addCliToolsToMcp`** — expose any goke CLI as MCP tools. Mounts `tools/list` and `tools/call` handlers on a low-level `Server` or high-level `McpServer`, with automatic tool-name sanitization, positional argument support, and composition with tools already registered on the server:
   ```ts
   import { addCliToolsToMcp } from '@goke/mcp'
   addCliToolsToMcp({ cli, server })
   ```

## 0.0.5

- Build: clean `dist` before `tsc` to remove stale generated files
- Publish: route `prepublishOnly` through `pnpm build` so publish artifacts are rebuilt from scratch

## 0.0.4

- Fix: preserve boolean defaults in MCP tools
- Refactor: adapt to new Goke option API
- Chore: rename from mcpcac to @goke/mcp

## 0.0.3

- Format JSON outputs as YAML for better readability using js-yaml
- Add truthy check before YAML conversion to handle falsy values gracefully

## 0.0.2

- Initial release
- Auto-discovery of MCP server tools
- CLI command generation from JSON schema
- OAuth support with lazy authentication
- Tool caching for 1 hour
- Session ID reuse to skip MCP initialization handshake
