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

That matches MCP SDK v1 Streamable HTTP without optional transport sessions (`2025-11-25`). Session IDs are optional. Stateless servers omit them. Check `Origin` when the header is present. This works on Cloudflare Workers, where process memory does not survive across requests.
