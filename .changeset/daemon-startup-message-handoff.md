---
'goke': patch
---

Add a reliable startup-message handoff for detached daemons.

OAuth and device-login commands can now create an authorization URL inside the daemon, publish ordered stdout or stderr messages to the foreground process, and signal when startup is ready:

```ts
if (ctx.daemon.isDaemon) {
  const flow = await startOAuthFlow()
  ctx.daemon.publishStartupMessage(`Authorize: ${flow.authorizationUrl}`)
  ctx.daemon.ready()
  await flow.waitForApproval()
  return
}

await ctx.daemon.start({
  waitForStartup: true,
  timeoutMs: 10 * 60 * 1000,
})
```

Detached stdin, stdout, and stderr remain ignored. The handoff uses a private one-shot file with filesystem notifications, removes it on every completion or failure path, and stops daemons that fail before startup becomes ready. Attached mode continues to stream output and wait for daemon exit.
