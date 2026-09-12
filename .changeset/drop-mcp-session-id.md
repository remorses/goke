---
'@goke/mcp': minor
'notion-mcp-cli': patch
---

Stop caching and reusing MCP `sessionId`. Tool schemas still cache for 1 hour. Each CLI invocation opens a new connection.

Remote HTTP recipes now clone the CLI **per request** from request auth. They no longer keep a `Map` of transports keyed by `Mcp-Session-Id`.

```ts
const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
  enableJsonResponse: true,
})
```

`getMcpTransport` no longer receives a session id argument.

```ts
await addMcpCommands({
  cli,
  getMcpTransport: () => new StdioClientTransport({ command: 'my-server' }),
  loadCache,
  saveCache,
})
```
