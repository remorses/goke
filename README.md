# notion-mcp-cli

CLI for Notion MCP with OAuth support.

## Installation

```bash
npm install -g notion-mcp-cli
```

## Usage

```bash
# Login (saves MCP URL, auth happens on first command)
notion-mcp-cli login

# Run any Notion MCP tool
notion-mcp-cli notion-search --query "meeting notes"
notion-mcp-cli notion-get-page --pageId "abc123"

# Check status
notion-mcp-cli status

# Logout
notion-mcp-cli logout
```

## How it works

1. On first command, opens browser for Notion OAuth
2. Caches tools and session for 1 hour
3. Auto-refreshes tokens when needed

## Packages

This monorepo contains:

| Package | Description |
|---------|-------------|
| [notion-mcp-cli](./notion-mcp-cli) | CLI for Notion MCP |
| [mcpcac](./mcpcac) | Generate CLI commands from any MCP server |
| [goke](./goke) | cac-inspired CLI framework with space-separated subcommands |

## mcpcac

Use `mcpcac` to build your own MCP CLI:

```ts
import { goke } from 'goke'
import { addMcpCommands } from 'mcpcac'

const cli = goke('mycli')

await addMcpCommands({
  cli,
  commandPrefix: 'mcp',
  getMcpUrl: () => 'https://your-mcp-server.com/mcp',
  oauth: {
    clientName: 'My CLI',
    load: () => loadConfig().oauth,
    save: (state) => saveConfig({ oauth: state }),
  },
  loadCache: () => loadConfig().cache,
  saveCache: (cache) => saveConfig({ cache }),
})

cli.parse()
```

## License

MIT
