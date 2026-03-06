# @goke/mcp

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
