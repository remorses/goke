---
'goke': minor
---

Make a `<value>` flag required to pass by using a schema that rejects omit.

`--days <days>` still only means **the flag needs a value if it is present**. You cannot pass `--days` with nothing after it. The flag itself stays optional unless the schema rejects `undefined`.

```ts
.option('--url <url>', z.string())                 // flag required
.option('--name <name>', z.string().optional())    // flag optional, value required if present
.option('--port <port>', z.number().default(3000)) // flag optional, default fills in
```

Errors now say what to do:

```
error: option `--url <url>` is required
error: option `--port <port>` needs a value. Do not pass `--port` with no argument.
error: missing required argument `<slug>` for command `projects create <slug>`
```
