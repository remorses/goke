# @goke/mcp

Turn any [MCP](https://modelcontextprotocol.io) server into a CLI. Connects to the server, discovers tools, and generates CLI commands with typed arguments — automatically.

## Install

```bash
npm install @goke/mcp goke
```

`goke` is a peer dependency (the CLI framework that commands are registered on).

## How it works

```
MCP server                        Your CLI
┌──────────────────┐              ┌──────────────────────────┐
│  tools/list      │──discover──▸ │  mycli notion-search     │
│  - notion-search │              │  mycli notion-get-page   │
│  - notion-get-…  │              │  mycli notion-create-…   │
│  (JSON Schema)   │──coerce───▸ │  --query <string>        │
│                  │              │  --pageId <string>       │
└──────────────────┘              └──────────────────────────┘
```

1. **Discover** — calls `tools/list` on the MCP server to get every tool + its JSON Schema
2. **Register** — creates a CLI command per tool with `--options` derived from the schema
3. **Cache** — tools and session ID are cached for 1 hour (no network on subsequent runs). Expired cache is still used when a live fetch is impossible (no token, 401 on `--help`)
4. **Execute** — on invocation, connects to the server and calls the tool with coerced arguments
5. **OAuth** — if the server returns 401, automatically opens the browser for OAuth, then retries. `--help`, `--version`, `completions`, and no-args never start OAuth

## Quick start

```ts
import { goke } from 'goke'
import { addMcpCommands } from '@goke/mcp'
import type { McpOAuthState, CachedMcpTools } from '@goke/mcp'

const cli = goke('notion-mcp-cli')

await addMcpCommands({
  cli,
  getMcpUrl: () => 'https://mcp.notion.com/mcp',
  oauth: {
    clientName: 'Notion CLI',
    load: () => loadConfig().oauthState,
    save: (state) => saveConfig({ oauthState: state }),
  },
  loadCache: () => loadConfig().cache,
  saveCache: (cache) => saveConfig({ cache }),
})

cli.help()
cli.completions()
cli.parse()
```

If the MCP server is HTTP, pass `getMcpUrl` even when the user has no token. `--help` and no-args must still run so the CLI can show `config` / login instructions. Use `getMcpTransport` when you need stdio or a custom transport.

For an HTTP Bearer token, pass `getHeaders`:

```ts
await addMcpCommands({
  cli,
  getMcpUrl: () => 'https://api.example.com/mcp',
  getHeaders: () => {
    const token = process.env.EXAMPLE_TOKEN || loadConfig().token
    if (!token) return
    return { Authorization: `Bearer ${token}` }
  },
  loadCache: () => loadConfig().cache,
  saveCache: (cache) => saveConfig({ cache }),
})
```

That's it. Every tool the MCP server exposes becomes a CLI command:

```bash
notion-mcp-cli notion-search --query "meeting notes"
notion-mcp-cli notion-retrieve-page --page_id "abc123"
notion-mcp-cli notion-list-users
```

## Expose a CLI as an MCP server

`createMcpAction()` turns your entire CLI into a stdio MCP server with one line. Every CLI command becomes an MCP tool automatically. The command you attach it to is excluded from the tool list.

```ts
import { goke } from "goke"
import { z } from "zod"
import { createMcpAction } from "@goke/mcp"

const cli = goke("my-cli")

cli
  .command("search", "Search pages")
  .option("--query <query>", z.string().describe("Search query"))
  .option("--limit [limit]", z.number().default(10).describe("Max results"))
  .action((options) => {
    return { results: findPages(options.query, options.limit) }
  })

cli
  .command("deploy <env>", "Deploy to environment")
  .option("--dry-run", z.boolean().default(false).describe("Simulate"))
  .action((env, options) => {
    return options.dryRun ? `would deploy to ${env}` : deploy(env)
  })

// Add MCP support — runs a stdio MCP server when the user invokes `my-cli mcp`
cli.command("mcp", "Start MCP server over stdio")
  .action(createMcpAction({ cli }))

cli.help()
cli.completions()
cli.parse()
```

Now users can use your CLI directly **or** connect it as an MCP server:

```bash
# Use as a normal CLI
my-cli search --query "meeting notes"
my-cli deploy staging --dry-run

# Use as an MCP server (e.g. from Claude Desktop, Cursor, etc.)
my-cli mcp
```

When running as MCP, the server exposes `search` and `deploy` as tools. The `mcp` command itself is excluded. Options with Zod schemas (or any Standard Schema) become typed `inputSchema` properties in the MCP tool definition.

### Installing the MCP server in clients

Users can install your CLI as an MCP server in any client using [`@playwriter/install-mcp`](https://github.com/nicepkg/install-mcp) — a cross-platform tool that handles config file locations for every major MCP client:

```bash
# Install in Claude Desktop
npx @playwriter/install-mcp my-cli --client claude-desktop

# Install in Cursor
npx @playwriter/install-mcp my-cli --client cursor

# Install in VS Code
npx @playwriter/install-mcp my-cli --client vscode
```

This works with any client: `claude-desktop`, `cursor`, `vscode`, `windsurf`, `claude-code`, `opencode`, `zed`, `goose`, `cline`, `codex`, `gemini-cli`, and [more](https://github.com/supermemoryai/install-mcp#supported-clients). If the command needs custom arguments, pass the full command string:

```bash
npx @playwriter/install-mcp 'npx my-cli mcp' --client cursor
```

`createMcpAction` accepts the same filtering options as `addCliToolsToMcp`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cli` | `Goke` | **required** | The CLI instance to expose |
| `commandFilter` | `(name) => boolean` | — | Additional filter (MCP command is always excluded) |
| `sanitizeToolName` | `(name) => string` | — | Custom tool name sanitizer |
| `serverName` | `string` | CLI name | MCP server name |
| `serverVersion` | `string` | `'1.0.0'` | MCP server version |
| `createTransport` | `() => Transport` | stdio | Custom transport factory |

### Advanced: `addCliToolsToMcp`

For more control (composing with existing MCP tools, using a custom server), use `addCliToolsToMcp()` directly:

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { addCliToolsToMcp } from "@goke/mcp"

const server = new Server(
  { name: "my-cli-mcp", version: "1.0.0" },
  { capabilities: {} },
)

// Mount CLI commands as tools alongside your own
addCliToolsToMcp({ cli, server })

const transport = new StdioServerTransport()
await server.connect(transport)
```

Also works with the high-level `McpServer`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

const mcp = new McpServer({ name: "my-cli-mcp", version: "1.0.0" })
mcp.tool("custom-tool", "A tool defined directly", async () => ({ ... }))
addCliToolsToMcp({ cli, server: mcp })
```

## Multi-tenant remote MCP over HTTP

When you expose a cli as a **remote** MCP (over `StreamableHTTPServerTransport`, SSE, or any other network transport), one server process handles many concurrent users. Each tool call must run against that user's own filesystem, working directory, environment, and stdin — otherwise tenants see each other's state and stdio writes trample the JSON-RPC channel.

The recipe is:

1. Define the cli **once**.
2. On every new MCP session, **clone** the cli with per-tenant `{ cwd, env, fs, stdin }` and mount it on a fresh session-scoped `Server` via `addCliToolsToMcp({ cli: tenantClone, server })`.
3. Inside command actions, always use the **injected** `ctx` — `ctx.fs`, `ctx.process.cwd`, `ctx.process.env`, `ctx.console.log` — instead of the Node globals. `@goke/mcp` wires each tool call into the tenant's cloned context, but only code that goes through `ctx` participates in that isolation.

### Write commands against `ctx`

```ts
import { goke } from "goke"
import { z } from "zod"
import path from "node:path"

const cli = goke("notes-app")

cli
  .command("save <filename>", "Save content into the user's workspace")
  .option("--content <content>", z.string().describe("File content"))
  .action(async (filename, options, ctx) => {
    const full = path.posix.join(ctx.process.cwd, filename)
    await ctx.fs.writeFile(full, options.content)
    return { saved: full, tenant: ctx.process.env.TENANT_ID }
  })

cli
  .command("load <filename>", "Load a file from the user's workspace")
  .action(async (filename, _options, ctx) => {
    const full = path.posix.join(ctx.process.cwd, filename)
    const text = await ctx.fs.readFile(full, "utf8")
    return { path: full, text }
  })
```

`ctx.fs` satisfies the `GokeFs` interface — a Node-compatible async filesystem API. You can point it at a real directory, a virtual in-memory store, an S3 bucket adapter, a `memfs`, or anything else you can wrap behind that interface.

### Clone the cli per session

The MCP SDK ships `WebStandardStreamableHTTPServerTransport`, which accepts a Web-Standard `Request` and returns a `Response`. That one shape plugs directly into **any** web framework that speaks web-standard: [Spiceflow](https://github.com/remorses/spiceflow), Cloudflare Workers, Deno, Bun, Next.js route handlers, SvelteKit endpoints, or a raw `fetch`-based handler. No Express, no `node:http` wiring, no framework lock-in.

You build one `handleMcpRequest(request: Request): Promise<Response>` function and mount it wherever you route HTTP:

```ts
import { randomUUID } from "node:crypto"
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { addCliToolsToMcp } from "@goke/mcp"
import type { GokeFs } from "goke"

// Wherever you store per-user state — DB, Redis, config files, etc.
declare function resolveTenant(tenantId: string): {
  cwd: string
  env: Record<string, string>
  fs: GokeFs   // your filesystem adapter
}

const transports = new Map<string, WebStandardStreamableHTTPServerTransport>()

export async function handleMcpRequest(request: Request): Promise<Response> {
  // Pre-parse the body so we can use it for both routing decisions
  // (is this an `initialize` request?) and as the pre-parsed body
  // forwarded to the transport via `HandleRequestOptions.parsedBody`.
  let parsedBody: unknown
  if (request.method === "POST") {
    parsedBody = await request.clone().json().catch(() => undefined)
  }

  const sessionId = request.headers.get("mcp-session-id")

  // Existing session — route to its transport.
  if (sessionId && transports.has(sessionId)) {
    return transports.get(sessionId)!.handleRequest(request, { parsedBody })
  }

  // No session yet — must be an `initialize` request.
  if (!isInitializeRequest(parsedBody)) {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
        id: null,
      },
      { status: 400 },
    )
  }

  // Derive the tenant from whatever header/cookie/JWT you use.
  const tenantId = request.headers.get("x-tenant-id")
  if (!tenantId) return new Response("missing x-tenant-id", { status: 401 })
  const tenant = resolveTenant(tenantId)

  // Clone the base cli with tenant-specific cwd/env/fs. Every tool
  // call on this session now sees the tenant's state via `ctx`.
  const tenantCli = baseCli.clone({
    cwd: tenant.cwd,
    env: { ...tenant.env, TENANT_ID: tenantId },
    fs: tenant.fs,
  })

  const mcpServer = new McpServer(
    { name: "notes-app-mcp", version: "1.0.0" },
    { capabilities: {} },
  )
  addCliToolsToMcp({ cli: tenantCli, server: mcpServer })

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true, // pure request/response; no SSE to manage
    onsessioninitialized: (sid) => {
      transports.set(sid, transport)
    },
    onsessionclosed: (sid) => {
      transports.delete(sid)
    },
  })
  transport.onclose = () => {
    const sid = transport.sessionId
    if (sid) transports.delete(sid)
  }

  await mcpServer.connect(transport)
  return transport.handleRequest(request, { parsedBody })
}
```

Now plug `handleMcpRequest` into whichever web runtime you use:

```ts
// Spiceflow — runs on Node, Bun, and Cloudflare Workers with the same code
import { Spiceflow } from "spiceflow"

export const app = new Spiceflow()
  .route({
    method: "*",
    path: "/mcp",
    handler: ({ request }) => handleMcpRequest(request),
  })

app.listen(3000)

// Cloudflare Workers / Deno / Bun
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === "/mcp") return handleMcpRequest(request)
    return new Response("not found", { status: 404 })
  },
}

// Next.js app router
export async function POST(request: Request) {
  return handleMcpRequest(request)
}
```

**Key guarantees**

- Every tool call inside a session runs against `tenantCli`'s `cwd` / `env` / `fs` — not the base cli's and not another tenant's.
- `ctx.console.log` / `ctx.console.error` / `ctx.process.stdout.write` / `ctx.process.stderr.write` are captured into the `CallToolResult.content`. They never reach the host process stdio, so they can't corrupt the JSON-RPC channel or leak between users.
- `ctx.process.exit(code)` throws `GokeProcessExit` instead of killing the server. The tool call resolves as `{ isError: code !== 0, content: [captured output] }` and the next request keeps running.
- Actions that `throw` are caught and returned as `{ isError: true, content: [message, stderr] }`.

**Bypass hazards**

Only code that flows through `ctx` participates in the isolation. The following **bypass** it and will leak across tenants or kill the host process:

- `import fs from "node:fs"` inside a command action — reads/writes the real disk.
- `console.log(...)` / `console.error(...)` — writes to the real server stdio.
- `process.exit(1)` — terminates the entire host process.
- `process.cwd()` / `process.env.X` at module load time — snapshots the server's values, not the tenant's.

Port those to `ctx.fs`, `ctx.console`, `ctx.process.*` and you're multi-tenant-safe.

For a runnable end-to-end example (including two concurrent in-memory-fs tenants writing separate files), see [`src/__test__/http-multi-tenant.test.ts`](./src/__test__/http-multi-tenant.test.ts).

### Lower-level primitive: `cli.createExecutionContext(override)`

If you're building a custom transport or a non-HTTP multi-tenant adapter, the underlying goke primitive is:

```ts
import { GokeProcessExit, type GokeExecutionContextOverride } from "goke"

const override: GokeExecutionContextOverride = {
  cwd: tenant.cwd,
  env: tenant.env,
  fs: tenant.fs,
  stdin: tenant.stdin,
  stdout: captureStdoutStream,
  stderr: captureStderrStream,
  exit: () => {}, // throw-only: the wrapper still throws GokeProcessExit
}

const ctx = cli.createExecutionContext(override)

try {
  await action(...positionalArgs, options, ctx)
} catch (err) {
  if (err instanceof GokeProcessExit) {
    // handle the exit code — the host process is untouched
  } else {
    throw err
  }
}
```

`addCliToolsToMcp` builds this context for you on every tool call. Call it yourself if you need finer control (e.g. per-request capture streams for custom routing, synthetic `argv`, or serving MCP from a non-Node runtime that implements `GokeFs` differently).

## Full example (with config persistence)

This is the pattern used by [notion-mcp-cli](../notion-mcp-cli):

```ts
import { goke } from 'goke'
import { addMcpCommands } from '@goke/mcp'
import type { McpOAuthState, CachedMcpTools } from '@goke/mcp'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// --- Config persistence (JSON file in ~/.myapp/) ---

const CONFIG_DIR = path.join(os.homedir(), '.myapp')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

interface AppConfig {
  mcpUrl: string
  oauthState?: McpOAuthState
  cache?: CachedMcpTools
}

function loadConfig(): AppConfig {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
  } catch {
    return { mcpUrl: 'https://mcp.notion.com/mcp' }
  }
}

function saveConfig(partial: Partial<AppConfig>): void {
  const merged = { ...loadConfig(), ...partial }
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2))
}

// --- CLI setup ---

const cli = goke('myapp')

await addMcpCommands({
  cli,
  clientName: 'myapp',
  getMcpUrl: () => loadConfig().mcpUrl,
  oauth: {
    clientName: 'My App',
    load: () => loadConfig().oauthState,
    save: (state) => saveConfig({ oauthState: state }),
  },
  loadCache: () => loadConfig().cache,
  saveCache: (cache) => saveConfig({ cache }),
})

// Custom commands alongside auto-generated MCP commands
cli
  .command('login', 'Save MCP URL')
  .option('--url <url>', 'MCP server URL')
  .action((options) => {
    saveConfig({ mcpUrl: options.url })
    console.log(`Saved: ${options.url}`)
  })

cli.command('logout', 'Clear tokens').action(() => {
  saveConfig({ oauthState: undefined, cache: undefined })
  console.log('Logged out')
})

cli.help()
cli.completions()
cli.parse()
```

## API

### `addMcpCommands(options)`

Registers MCP tool commands on a goke CLI instance.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cli` | `Goke` | **required** | The goke CLI instance to add commands to |
| `getMcpUrl` | `() => string \| undefined` | — | Returns the MCP server URL. Return the URL even when the user is not logged in so `--help` still works |
| `getMcpTransport` | `(sessionId?) => Transport \| null` | — | Custom transport. Use for stdio or anything `getMcpUrl` cannot express |
| `getHeaders` | `() => Record<string, string> \| undefined` | — | Extra HTTP headers (for example `Authorization`). Used with `getMcpUrl` |
| `argv` | `string[]` | `process.argv.slice(2)` | Args used to skip live discovery on help and already registered commands |
| `commandPrefix` | `string` | `''` | Prefix for commands (e.g. `'mcp'` makes `mcp notion-search`) |
| `clientName` | `string` | `'mcp-cli-client'` | Name sent to the MCP server during connection |
| `oauth` | `McpOAuthConfig` | — | OAuth config for servers that require authentication |
| `loadCache` | `() => CachedMcpTools \| undefined` | **required** | Load cached tools from storage |
| `saveCache` | `(cache) => void` | **required** | Save cached tools to storage |

### `McpOAuthConfig`

| Field | Type | Description |
|-------|------|-------------|
| `clientName` | `string` | Name shown on the OAuth consent screen |
| `load` | `() => McpOAuthState \| undefined` | Load persisted OAuth state |
| `save` | `(state) => void` | Save OAuth state after auth or token refresh |
| `onAuthUrl` | `(url: string) => void` | Custom handler for auth URL (default: opens browser) |
| `onAuthSuccess` | `() => void` | Called after successful authentication |
| `onAuthError` | `(error: string) => void` | Called on authentication failure |

### Exports

```ts
// MCP server → CLI (consume MCP tools as CLI commands)
export { addMcpCommands } from '@goke/mcp'
export type { AddMcpCommandsOptions, CachedMcpTools } from '@goke/mcp'
export type { McpOAuthConfig, McpOAuthState } from '@goke/mcp'

// CLI → MCP server (expose CLI commands as MCP tools)
export { createMcpAction, addCliToolsToMcp } from '@goke/mcp'
export type { CreateMcpActionOptions, AddCliToolsToMcpOptions } from '@goke/mcp'
```

## OAuth flow

OAuth is **lazy** — no auth check happens on startup. The flow is:

```
User runs command
       │
       ▼
  Call MCP tool ───── success ──▸ Print result
       │
    401 error
       │
       ▼
  Start local server (random port)
       │
       ▼
  Open browser ──▸ User authorizes
       │
       ▼
  Receive callback with auth code
       │
       ▼
  Exchange code for tokens
       │
       ▼
  Save tokens via oauth.save()
       │
       ▼
  Retry the original tool call
```

Tokens are persisted via the `oauth.save()` callback you provide, so subsequent runs skip auth entirely.

## Caching

Tools and the MCP session ID are cached for **1 hour** to avoid connecting on every invocation. The cache is managed through the `loadCache`/`saveCache` callbacks — you control where it's stored (file, database, env, etc.).

When the cache expires or a tool call fails, the cache is cleared and tools are re-fetched on the next run.

If a live `tools/list` cannot run (no transport, 401 during `--help`), `addMcpCommands` still registers tools from an expired cache so help stays useful.

## License

MIT
