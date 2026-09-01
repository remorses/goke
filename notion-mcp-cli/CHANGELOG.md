# notion-mcp-cli

## 0.0.9

1. **Agent-friendly login via background daemon** — when running inside an AI coding agent (Claude, Cursor, Codex, etc.), `notion-mcp-cli login` now starts a background daemon and returns immediately instead of blocking the terminal. The user approves in their browser; the agent polls with `me` to check when auth completes:

   ```bash
   notion-mcp-cli login
   # → "Login server running in background (10 min timeout)."

   # Poll until authenticated:
   notion-mcp-cli me
   # → exits 0 with "Authenticated" when done
   # → exits 1 with "Login in progress" or "Not logged in"
   ```

   Interactive (non-agent) mode still runs the OAuth flow directly and blocks until done.

2. **New `me` command** — simple auth status check that exits 0 if authenticated, 1 if not. Agents use this to poll after starting a background login:

   ```bash
   notion-mcp-cli me
   ```

3. **Logout stops running login daemon** — `notion-mcp-cli logout` now also kills any background login daemon via `ctx.daemon.forCommand('login')`.

## 0.0.8

1. **Added `./src` and `./src/*` exports** — import directly from source TypeScript files without going through `dist`.
2. **Added `exports` map** — explicit package exports with `./package.json` support.
3. **Added package metadata** — `homepage`, `bugs`, `repository.directory` for better discoverability on npm.

## 0.0.7

1. **Updated to goke 6.2.0** — picks up formatted error output, `helpText()`, deprecated option support, and help visual improvements.

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
