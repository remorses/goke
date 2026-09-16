---
'@goke/mcp': patch
---

Stop putting CLI `<value>` flags into MCP `inputSchema.required` just because the flag needs a value when present.

`--days <days>` means the **value is required if the flag is present**. The flag itself is still optional unless the schema rejects omit (`z.string()`, not `z.string().optional()`). MCP `required` now lists required positionals plus schema-required flags.

```ts
cli
  .command('projects create <slug>', 'Create a project')
  .option('--traces-days <days>', z.string().optional())
  .option('--url <url>', z.string())
```

Generated MCP schema:

```json
{
  "properties": {
    "slug": { "type": "string" },
    "tracesDays": { "type": "string" },
    "url": { "type": "string" }
  },
  "required": ["slug", "url"]
}
```
