---
'@goke/mcp': patch
---

Stop putting optional CLI flags with `<value>` syntax into MCP `inputSchema.required`.

`--days <days>` means the **value is required if the flag is present**. The flag itself is still optional. MCP JSON Schema has no "required if present" bit, so only **required positionals** like `<slug>` belong in `required`.

Before, `projects create --traces-days <days>` made MCP clients send `tracesDays` even when they only had a slug. After, those flags stay in `properties` and can be omitted.

```ts
cli
  .command('projects create <slug>', 'Create a project')
  .option('--traces-days <days>', z.string())
```

Generated MCP schema:

```json
{
  "properties": {
    "slug": { "type": "string" },
    "tracesDays": { "type": "string" }
  },
  "required": ["slug"]
}
```
