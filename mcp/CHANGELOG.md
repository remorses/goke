# @goke/mcp

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
