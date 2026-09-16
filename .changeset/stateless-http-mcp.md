---
'@goke/mcp': patch
---

Document remote HTTP MCP as **stateless**. Each POST clones the CLI and builds a fresh Server. Do not keep `mcp-session-id` or a `Map` of transports.

```ts
const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
  enableJsonResponse: true,
})
```

That matches the MCP SDK stateless mode and works on Cloudflare Workers, where process memory does not survive across requests.
