# @goke/mcp

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
