---
'@goke/mcp': minor
---

CLI commands exposed as MCP tools now behave more like the command line.

- **Global options are tool arguments.** A `cli.option('--account [account]', ...)` appears in every tool's `inputSchema` and reaches `options.account`. `--help` and `--version` are skipped.
- **Arguments are coerced like argv.** Plain flags without a schema were passed through as is, so `force: "false"` reached the action as a truthy string. Now `"false"` becomes `false`, and values that do not fit (`"maybe"` for a boolean, a number for a plain flag) fail with `InvalidParams` before the action runs.
- **New `isMcpToolCall(ctx)`** returns true inside a tool call. Use it to refuse things that need a terminal, like reading `process.stdin`, which is the JSON-RPC channel of a stdio server.
