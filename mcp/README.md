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
3. **Cache** — tools and session ID are cached for 1 hour (no network on subsequent runs)
4. **Execute** — on invocation, connects to the server and calls the tool with coerced arguments
5. **OAuth** — if the server returns 401, automatically opens the browser for OAuth, then retries

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
cli.parse()
```

That's it. Every tool the MCP server exposes becomes a CLI command:

```bash
notion-mcp-cli notion-search --query "meeting notes"
notion-mcp-cli notion-retrieve-page --page_id "abc123"
notion-mcp-cli notion-list-users
```

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
  .action((options: { url: string }) => {
    saveConfig({ mcpUrl: options.url })
    console.log(`Saved: ${options.url}`)
  })

cli.command('logout', 'Clear tokens').action(() => {
  saveConfig({ oauthState: undefined, cache: undefined })
  console.log('Logged out')
})

cli.help()
cli.parse()
```

## API

### `addMcpCommands(options)`

Registers MCP tool commands on a goke CLI instance.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cli` | `Goke` | **required** | The goke CLI instance to add commands to |
| `getMcpUrl` | `() => string \| undefined` | — | Returns the MCP server URL |
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
// Main function
export { addMcpCommands } from '@goke/mcp'

// Types
export type { AddMcpCommandsOptions } from '@goke/mcp'
export type { CachedMcpTools } from '@goke/mcp'
export type { McpOAuthConfig, McpOAuthState } from '@goke/mcp'
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

## License

MIT
