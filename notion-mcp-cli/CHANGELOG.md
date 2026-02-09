# notion-mcp-cli

## 0.0.6

- Build: clean `dist` before compiling to avoid stale declaration files in published output
- Publish: run `prepublishOnly` via `pnpm build` to guarantee fresh artifacts on release

## 0.0.5

- Fix: fix login --url required argument regression
- Refactor: update to use new Goke option API

## 0.0.4

- JSON outputs are now formatted as YAML for better readability

## 0.0.3

- Update dependencies

## 0.0.2

- Initial release
- OAuth authentication with Notion MCP server
- Commands: login, logout, status
- Auto-generated commands from Notion MCP tools
