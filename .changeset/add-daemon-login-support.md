---
'goke': minor
'@goke/mcp': minor
'notion-mcp-cli': minor
---

Add background daemon support for agent-friendly login flows.

`goke` now exposes `ctx.daemon` in command actions so a command can re-run itself as a detached background process:

```ts
cli.command('login', 'Authenticate').action(async (options, ctx) => {
  if (ctx.daemon.isDaemon) {
    await waitForBrowserCallback()
    return
  }

  await ctx.daemon.start({ timeoutMs: 10 * 60 * 1000 })
  ctx.console.log('Login running in background')
})
```

Pass short handoff values to the daemon with `ctx.daemon.start({ env })`, then read them from `ctx.process.env` in the daemon branch.

`@goke/mcp` exports `startOAuthFlow()` for CLIs that need an explicit login command instead of waiting for lazy auth during a tool call.

`notion-mcp-cli login` uses the daemon flow when running inside an agent, and the new `notion-mcp-cli me` command gives agents a simple auth check after the user approves in the browser.
