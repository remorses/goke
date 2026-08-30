<div align='center'>
    <br/>
    <br/>
    <h3>goke</h3>
    <p>Build CLIs like you'd build an API. Type-safe, chainable, zero dependencies.</p>
    <br/>
    <br/>
</div>

goke is a TypeScript CLI framework with a [Hono](https://hono.dev)-like API. You chain `.use()` for middleware and `.command()` for routes — the same mental model as a REST API, applied to the terminal.

```ts
import { goke } from 'goke'
import { z } from 'zod'

const cli = goke('deploy')

// middleware — runs before every command
cli
  .option('--env <env>', z.enum(['staging', 'production']).default('staging').describe('Target environment'))
  .use((options, { console }) => {
    console.log(`Environment: ${options.env}`)
  })

// commands — like route handlers
cli
  .command('up', 'Deploy the app')
  .option('--dry-run', 'Preview without deploying')
  .action((options, { console, process }) => {
    console.log(`Deploying from ${process.cwd}`)
  })

cli
  .command('logs <deploymentId>', 'Stream logs')
  .option('--lines <n>', z.number().default(100).describe('Lines to tail'))
  .action((id, options) => streamLogs(id, options.lines))

cli.help()
cli.completions()
cli.parse()
```

## Features

- **Hono-like chaining** — `.use()` for middleware, `.command()` for handlers. Build a CLI the same way you'd design a REST API.
- **Zod type safety** — pass a Zod schema to `.option()` and get automatic coercion, TypeScript inference, and help text for free. Works with Valibot, ArkType, or any Standard Schema library.
- **CLI from any MCP server** — [`@goke/mcp`](https://github.com/remorses/goke/tree/main/mcp) connects to an MCP server, discovers tools, and generates typed CLI commands automatically.
- **MCP server in 2 lines** — expose your entire CLI as an MCP server with `createMcpAction({ cli })` from [`@goke/mcp`](https://github.com/remorses/goke/tree/main/mcp). Every command becomes a tool, ready for Claude Desktop, Cursor, VS Code, and [any MCP client](https://github.com/supermemoryai/install-mcp#supported-clients).
- **JustBash support** — `cli.createJustBashCommand()` exposes your CLI as a sandboxed JustBash command. Same action code, no changes needed.
- **Space-separated subcommands** — `git remote add`, `mcp login`, `db migrate` — multi-word commands work out of the box.
- **Injected `{ fs, console, process }`** — commands receive a portable runtime context. Swap it in tests, or let JustBash replace it with a sandbox. No global side effects.
- **Shell completions** — `cli.completions()` adds Tab completion for zsh and bash. Install once with `mycli completions install`; completions stay up-to-date automatically because the shell calls the binary on every Tab press.
- **Zero runtime dependencies** — install `goke` without pulling extra runtime packages into your CLI.
- **Agent detection** — `isAgent` and `detectAgent()` tell you if the process is running inside an AI coding agent (Claude, Cursor, Codex, Gemini, etc.). Skip prompts, prefer structured output, adjust behavior automatically.

## Install

```bash
npm install goke
```

## Install skill for AI agents

```bash
npx -y skills add remorses/goke
```

This installs the repository skill for AI coding agents. In this repo the shipped skill lives at `skills/goke/SKILL.md`.

## Generate a CLI from an MCP server

Use [`@goke/mcp`](https://github.com/remorses/goke/tree/main/mcp) to turn any MCP server into a CLI. It discovers tools and registers a typed command for each one.

```ts
import { goke } from 'goke'
import { addMcpCommands } from '@goke/mcp'

const cli = goke('mycli')

await addMcpCommands({
  cli,
  getMcpUrl: () => 'https://mcp.example.com/mcp',
  loadCache: () => loadConfig().cache,
  saveCache: (cache) => saveConfig({ cache }),
})

cli.help()
cli.completions()
cli.parse()
```

Every tool becomes a command:

```bash
mycli search --query "meeting notes"
mycli get-page --pageId "abc123"
```

See the [`@goke/mcp` README](https://github.com/remorses/goke/tree/main/mcp) for OAuth, caching, and exposing a CLI as an MCP server.

## Agent Detection

goke can detect if your CLI is being run by an AI coding agent. This is useful for skipping interactive prompts, preferring structured output, or adjusting behavior when an agent is driving the CLI.

```ts
import { isAgent, agent, agentInfo, detectAgent } from 'goke'

if (isAgent) {
  console.log(`Running inside ${agent}`) // e.g. "claude", "cursor", "codex"
}

// Re-run detection (e.g. after env changes)
const info = detectAgent()
console.log(info) // { name: "claude" } or {}
```

Detection works by scanning environment variables set by known agents. The `AI_AGENT` env var can be set explicitly to override detection.

**Supported agents:** `cursor`, `claude`, `devin`, `replit`, `gemini`, `codex`, `auggie`, `opencode`, `kiro`, `goose`, `pi`

A common pattern is combining agent detection with the interactive prompt fallback:

```ts
import { goke, isAgent } from 'goke'
import * as clack from '@clack/prompts'

cli
  .command('deploy', 'Deploy the app')
  .option('--env [env]', z.enum(['staging', 'production']).optional().describe('Target environment'))
  .action(async (options) => {
    let env = options.env

    if (!env) {
      if (isAgent || !process.stdin.isTTY) {
        // Agent or non-TTY: fail with clear usage instead of hanging on a prompt
        console.error('Missing --env. Usage: deploy --env staging|production')
        process.exit(1)
      }

      const choice = await clack.select({
        message: 'Which environment?',
        options: [
          { value: 'staging', label: 'Staging' },
          { value: 'production', label: 'Production' },
        ],
      })
      if (clack.isCancel(choice)) process.exit(0)
      env = choice
    }
  })
```

The detection logic is ported from [unjs/std-env](https://github.com/unjs/std-env). Agent-specific env vars checked include `CLAUDECODE`, `CURSOR_AGENT`, `CODEX_SANDBOX`, `GEMINI_CLI`, `OPENCODE`, and others. IDE-based agents (Cursor, Devin, Kiro) are checked last so that agents running inside those IDEs are detected by their own env vars first.

## Background Daemons

Use daemons for any command that needs to **wait for something external** (browser callback, polling an API, watching files) while the CLI returns immediately. This is the recommended pattern for long-running commands because it works seamlessly with AI agents: the agent runs the command, gets control back instantly, and can poll a status command to check when the work is done. No tmux, no tuistory, no background process management needed on the agent side.

Every command gets a `ctx.daemon` object that can fork the current command into a **detached background process**. The daemon is identified by CLI name + command name. A PID file at `~/.config/goke/daemons/` tracks the running process. No HTTP server, no ports. The daemon and client communicate via shared files (config, auth tokens, etc.) that the CLI already manages.

```ts
import { goke, isAgent, openInBrowser } from 'goke'
import { z } from 'zod'
import { createAuthClient } from 'better-auth/client'
import { deviceAuthorizationClient } from 'better-auth/client/plugins'

const cli = goke('playwriter')

cli
  .command('cloud login', 'Authenticate with playwriter.dev')
  .option('--base-url <url>', z.string().default('https://playwriter.dev').describe('Website base URL'))
  .action(async (options, ctx) => {
    const client = createAuthClient({
      baseURL: options.baseUrl,
      plugins: [deviceAuthorizationClient()],
    })

    if (ctx.daemon.isDaemon) {
      // ── BACKGROUND DAEMON ─────────────────────────────────
      // The device_code was passed via env by the client.
      // Poll until user approves in browser.
      const deviceCode = ctx.process.env.DEVICE_CODE!
      const pollInterval = Number(ctx.process.env.POLL_INTERVAL || 5) * 1000
      const deadline = Date.now() + 10 * 60 * 1000

      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, pollInterval))
        const { data: token, error } = await client.device.token({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: deviceCode,
          client_id: 'playwriter-cli',
        })
        if (token?.access_token) {
          saveAuth({ token: token.access_token, baseUrl: options.baseUrl })
          return // daemon exits, PID file is cleaned up
        }
        if (error?.error === 'authorization_pending' || error?.error === 'slow_down') continue
        if (error) return // unrecoverable error, exit
      }
      return
    }

    // ── FOREGROUND CLIENT ─────────────────────────────────
    const { data, error } = await client.device.code({ client_id: 'playwriter-cli' })
    if (error || !data) {
      ctx.console.error(`Failed to request device code: ${error?.error_description || error?.error || 'unknown'}`)
      ctx.process.exit(1)
    }

    const url = data.verification_uri_complete
      || new URL(`/device?user_code=${data.user_code}`, options.baseUrl).toString()
    ctx.console.log(`\nOpen: ${url}`)
    ctx.console.log(`Code: ${data.user_code}\n`)
    await openInBrowser(url)

    // Start daemon, pass device_code and poll interval via env
    await ctx.daemon.start({
      timeoutMs: 10 * 60 * 1000,
      env: {
        DEVICE_CODE: data.device_code,
        POLL_INTERVAL: String(data.interval || 5),
      },
    })

    if (isAgent) {
      ctx.console.log('Login running in background.')
      ctx.console.log('After approving, verify with: playwriter cloud me')
      return
    }

    // Interactive: poll the auth file until tokens appear
    const deadline = Date.now() + (data.expires_in || 300) * 1000
    while (Date.now() < deadline) {
      if (loadAuth()) {
        ctx.console.log('Logged in!')
        return
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
    ctx.console.error('Timed out.')
    ctx.process.exit(1)
  })
```

### Passing data to the daemon

Use the `env` option on `ctx.daemon.start()` to pass **small handoff values** from the foreground command to the daemon. goke merges these values into the child process environment, alongside `GOKE_DAEMON=1` and the timeout metadata.

```ts
await ctx.daemon.start({
  timeoutMs: 10 * 60 * 1000,
  env: {
    DEVICE_CODE: data.device_code,
    POLL_INTERVAL: String(data.interval || 5),
  },
})
```

Read those values from `ctx.process.env` inside the daemon branch. This keeps the daemon action deterministic because the daemon is just the same command running again with a different environment.

```ts
if (ctx.daemon.isDaemon) {
  const deviceCode = ctx.process.env.DEVICE_CODE
  const pollInterval = Number(ctx.process.env.POLL_INTERVAL || 5) * 1000

  if (!deviceCode) {
    ctx.console.error('Missing DEVICE_CODE for login daemon')
    ctx.process.exit(1)
  }

  await pollUntilApproved({ deviceCode, pollInterval })
  return
}
```

Keep `env` values **short and non-sensitive when possible**. For larger state, write to your CLI config file before starting the daemon and pass only a lookup key in `env`. The daemon and foreground command should share durable results through files, for example saved auth tokens or cached status.

### Agent-friendly login check

Add a `me` command that exits 0 if logged in, 1 if not. Agents run this after `login` to verify. Use `ctx.daemon.forCommand('login')` to check the login daemon from a different command:

```ts
cli
  .command('cloud me', 'Check auth status (exits 1 if not logged in)')
  .action(async (options, ctx) => {
    if (loadAuth()) {
      ctx.console.log('Authenticated')
      return
    }

    // Check if login daemon is still running
    const loginDaemon = ctx.daemon.forCommand('cloud login')
    if (await loginDaemon.isRunning()) {
      ctx.console.error('Login in progress. Approve in browser first.')
      ctx.process.exit(1)
    }

    ctx.console.error('Not logged in. Run `playwriter cloud login` first.')
    ctx.process.exit(1)
  })

cli
  .command('cloud logout', 'Clear auth')
  .action(async (options, ctx) => {
    // Stop any running login daemon
    const loginDaemon = ctx.daemon.forCommand('cloud login')
    await loginDaemon.stop()
    clearAuth()
    ctx.console.log('Logged out')
  })
```

### Writing agent-friendly descriptions

When a command uses the daemon pattern, say so in its description. Agents read `--help` output to decide how to run commands. If the description doesn't mention that background handling is built in, agents will wrap the command in tmux, tuistory, or shell backgrounding, which is unnecessary and error-prone.

Include three things in the description: that the command handles backgrounding itself, how to check status, and that no external process management is needed.

```ts
cli
  .command(
    'login',
    dedent`
      Authenticate via browser OAuth.

      Starts a background daemon automatically and returns immediately.
      The daemon waits up to 10 minutes for browser approval, then exits.
      No tmux or background process management needed.

      Check status with: mycli me
    `,
  )
  .action(async (options, ctx) => {
    // daemon implementation...
  })
```

The `me` / status command should also mention what it checks:

```ts
cli
  .command(
    'me',
    dedent`
      Check auth status. Exits 0 if logged in, 1 if not.

      Use this to poll after 'login' completes in the background:

        mycli login
        mycli me    # exits 0 when auth is ready
    `,
  )
  .action(async (options, ctx) => {
    // status check...
  })
```

This way agents can run `mycli login` followed by `mycli me` in a loop, with no special process management.

### How it works

`ctx.daemon.start()` re-runs the **exact same CLI command** as a detached child process with `GOKE_DAEMON=1` in the environment. When goke parses the command again, `ctx.daemon.isDaemon` is `true`, so the action branches into daemon mode. The PID file tracks the daemon so `isRunning()` and `stop()` work from any command.

### API

| Method | Description |
|--------|-------------|
| `ctx.daemon.isDaemon` | `true` when running as the background daemon |
| `ctx.daemon.start({ timeoutMs?, env?, attach? })` | Spawn current command as detached daemon. Kills existing daemon first. |
| `ctx.daemon.stop()` | Kill the daemon for this command |
| `ctx.daemon.isRunning()` | Check if daemon is alive (PID + heartbeat) |
| `ctx.daemon.forCommand(name)` | Get a daemon context for a different command |

### Attached mode

Pass `attach: true` to pipe the daemon's stdout/stderr to the parent and wait for it to exit. This is useful for interactive login flows where the user wants to see real-time logs, progress, and error messages from the daemon instead of a generic timeout.

```ts
if (isAgent) {
  // Agent: fire and forget, check with `me` later
  await ctx.daemon.start({ timeoutMs: 10 * 60 * 1000, env: { DEVICE_CODE: code } })
  ctx.console.log('Login running in background. Verify with: mycli me')
  return
}

// Interactive: see all daemon output, block until done
await ctx.daemon.start({ attach: true, timeoutMs: 10 * 60 * 1000, env: { DEVICE_CODE: code } })
ctx.console.log('Login successful!')
```

When attached, `start()` throws if the daemon exits with a non-zero code. The daemon branch can use `ctx.console.log/error` and `ctx.process.exit(1)` normally; attached parents will see the output and get the error.

### Safety

Each daemon writes a **unique instance ID** and a **heartbeat** (updated every 5s) into the PID file. `isRunning()` requires both an alive PID and a fresh heartbeat (< 15s), preventing false positives from OS PID reuse after a crash. `stop()` only kills processes with a valid heartbeat. Cleanup handlers remove the PID file on exit, signals, and uncaught exceptions, but only if the file's instance ID still matches.

## Terminal Colors

goke ships a vendored `colors` export (picocolors API) so CLIs built with goke don't need to install `picocolors`, `chalk`, `kleur`, or any other color library. One fewer dependency in your tree.

```ts
import { colors } from 'goke'

console.log(colors.green('success'))
console.log(colors.red('error'))
console.log(colors.bold(colors.cyan('info')))
```

**Never install a separate color library.** Import `colors` from goke instead. It supports all standard formatters: `bold`, `dim`, `italic`, `underline`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `gray`, `bgRed`, `bgGreen`, etc. Color support is auto-detected from `NO_COLOR`, `FORCE_COLOR`, `--no-color`, `--color`, and TTY state.

## Usage

### Simple Parsing

Use goke as simple argument parser:


```ts
import { goke } from 'goke'
import { z } from 'zod'

const cli = goke()

cli.option(
  '--type [type]',
  z.string().default('node').describe('Choose a project type'),
)
cli.option('--name <name>', 'Provide your name')

cli.command('lint [...files]', 'Lint files').action((files, options, { console, process }) => {
  console.log(files, options, process.cwd)
})

cli
  .command('build [entry]', 'Build your app')
  .option('--minify', 'Minify output')
  .example('build src/index.ts')
  .example('build src/index.ts --minify')
  .action(async (entry, options, { console, process }) => { // options is type safe! no need to type it
    console.log(entry, options, process.env.NODE_ENV)
  })

cli.example((bin) => `${bin} lint src/**/*.ts`)

// Display help message when `-h` or `--help` appears
cli.help()
cli.completions()
// Display version number when `-v` or `--version` appears
cli.version('0.0.0')

cli.parse()
```

When examples are defined, help output includes an **Examples** section.

### Command Examples in Help

Use `.example(...)` on a command (or on `cli`) to show usage snippets in help:

```ts
import { goke } from 'goke'

const cli = goke('mycli')

cli
  .command('deploy', 'Deploy current app')
  .option('--env <env>', 'Target environment')
  .example('mycli deploy --env production')
  .example('mycli deploy --env staging')
  .action(() => {})

cli.example((bin) => `${bin} deploy --env production`)

cli.help()
cli.completions()
cli.parse()
```

### Rich Multi-line Command Descriptions (`string-dedent`)

When a command needs a long description (with bullets, quotes, inline code, and
multiple examples), use [`string-dedent`](https://www.npmjs.com/package/string-dedent)
to keep the source readable while preserving clean help output.

Install:

```bash
npm install string-dedent
```

Example with detailed command descriptions:

```ts
import { goke } from 'goke'
import dedent from 'string-dedent'

const cli = goke('acme')

cli
  .command(
    'release <version>',
    dedent`
      Publish a versioned release to your distribution channels.

      - **Validates** release metadata and changelog before publishing.
      - **Builds** production artifacts with reproducible settings.
      - **Tags** git history using semantic version format.
      - **Publishes** to npm and creates release notes.

      > Recommended flow: run with \`--dry-run\` first in CI to verify output.

      Examples:
      - \`acme release 2.4.0 --channel stable\`
      - \`acme release 2.5.0-rc.1 --channel beta --dry-run\`
      - \`acme release 3.0.0 --notes-file ./docs/releases/3.0.0.md\`
    `,
  )
  .option('--channel <name>', 'Target channel: stable, beta, alpha')
  .option('--notes-file <path>', 'Markdown file used as release notes')
  .option('--dry-run', 'Preview every step without publishing')
  .action((version, options, { console, process }) => {
    console.log('release', version, options, process.cwd)
  })

cli
  .command(
    'db migrate',
    dedent`
      Apply pending database migrations in a controlled sequence.

      - Runs migrations in timestamp order.
      - Stops immediately on first failure.
      - Prints SQL statements when \`--verbose\` is enabled.
      - Supports smoke-testing with \`--dry-run\`.

      > Safety: always run this command against staging before production.

      Examples:
      - \`acme db migrate\`
      - \`acme db migrate --target 20260210120000_add_users\`
      - \`acme db migrate --dry-run --verbose\`
    `,
  )
  .option('--target <migration>', 'Apply up to a specific migration id')
  .option('--dry-run', 'Print plan only, do not execute SQL')
  .option('--verbose', 'Show each executed statement')
  .action((options, { console, process }) => {
    console.log('migrate', options, process.stdin)
  })

cli.help()
cli.completions()
cli.parse()
```

Why this pattern works well:

- `dedent` keeps template literals readable in source files.
- Help text stays aligned without extra leading whitespace.
- You can include rich formatting patterns users already recognize:
  lists, quotes, and inline command snippets.
- Long descriptions remain maintainable as your CLI grows.

> IMPORTANT! string-dedent initial and ending line must always be empty or it will throw a runtime error. never do dedent`non empty line.`

### Rich `.example(...)` Blocks with `dedent`

You can also use `dedent` in `.example(...)` so examples stay readable in code and
render nicely in help output. A useful pattern is to make the **first line a `#`
comment** that explains the scenario.

```ts
import { goke } from 'goke'
import dedent from 'string-dedent'

const cli = goke('tuistory')

cli
  .command('start', 'Start an interactive session')
  .example(dedent`
    # Launch and immediately check what the app shows
    tuistory launch "claude" -s ai && tuistory -s ai snapshot --trim
  `)
  .example(dedent`
    # Start a focused coding session with explicit context
    tuistory start --agent code --context "Fix OAuth callback timeout"
  `)
  .example(dedent`
    # Recover recent activity and inspect the latest run details
    tuistory runs list --limit 5 && tuistory runs show --latest
  `)
  .action(() => {
    // command implementation
  })

cli
  .command('deploy', 'Deploy current workspace')
  .example(dedent`
    # Dry-run deployment first to validate plan
    tuistory deploy --env staging --dry-run
  `)
  .example(dedent`
    # Deploy production with release notes attached
    tuistory deploy --env production --notes ./docs/release.md
  `)
  .action(() => {
    // command implementation
  })

cli.help()
cli.completions()
cli.parse()
```

Notes:

- Keep each example focused on one workflow.
- Use the first `#` line as a human-readable intent label.
- Keep command lines copy-pastable (avoid placeholder-heavy examples).

Where examples are rendered today:

- For root help (`deploy --help`), examples from the root/default command appear in an **Examples** section at the end.
- For subcommand help (`deploy logs --help`), examples from that specific subcommand appear in its own **Examples** section at the end.

Inline snapshot-style output (many commands):

```txt
deploy

Usage:
  $ deploy [options]

Commands:
  deploy               Deploy the current project
  init                 Initialize a new project
  login                Authenticate with the server
  logout               Clear saved credentials
  status               Show deployment status
  logs <deploymentId>  Stream logs for a deployment

Options:
  --env <env>  Target environment
  --dry-run    Preview without deploying
  -h, --help   Display this message

Examples:
# Deploy to staging first
deploy --env staging --dry-run
```

```txt
deploy

Usage:
  $ deploy logs <deploymentId>

Options:
  --follow     Follow log output
  --lines <n>  Number of lines (default: 100)
  -h, --help   Display this message

Description:
  Stream logs for a deployment

Examples:
# Stream last 200 lines for a deployment
deploy logs dep_123 --lines 200
# Keep following new log lines
deploy logs dep_123 --follow
```

### Many Commands with a Root Command

Use `''` as the command name to define a root command that runs when no subcommand is given. This is useful for CLIs that have a primary action alongside several subcommands:

```ts
import { goke } from 'goke'
import { z } from 'zod'

const cli = goke('deploy')

// Root command — runs when user types just `deploy`
cli
  .command('', 'Deploy the current project')
  .option(
    '--env <env>',
    z.string().default('production').describe('Target environment'),
  )
  .option('--dry-run', 'Preview without deploying')
  .action((options, { console, process }) => {
    console.log(`Deploying to ${options.env} from ${process.cwd}...`)
  })

// Subcommands
cli
  .command('init', 'Initialize a new project')
  .option('--template <template>', 'Project template')
  .action((options, { console, process }) => {
    console.log('Initializing project in', process.cwd)
  })

cli.command('login', 'Authenticate with the server').action((options, { console, process }) => {
  console.log('Opening browser for login from', process.cwd)
})

cli.command('logout', 'Clear saved credentials').action((options, { console, process }) => {
  console.log('Logged out', process.env.USER)
})

cli
  .command('status', 'Show deployment status')
  .option('--json', 'Output as JSON')
  .action((options, { console, process }) => {
    console.log('Fetching status from', process.cwd)
  })

cli
  .command('logs <deploymentId>', 'Stream logs for a deployment')
  .option('--follow', 'Follow log output')
  .option('--lines <n>', z.number().default(100).describe('Number of lines'))
  .action((deploymentId, options, { console, process }) => {
    console.log(`Streaming logs for ${deploymentId} from ${process.cwd}...`)
  })

cli.help()
cli.completions()
cli.version('1.0.0')
cli.parse()
```

```bash
deploy                          # runs root command (deploy to production)
deploy --env staging --dry-run  # root command with options
deploy init --template react    # subcommand
deploy login                    # subcommand
deploy logs abc123 --follow     # subcommand with args + options
deploy --help                   # shows all commands
```

### Splitting a Large CLI into Files

As your CLI grows, define each command (or command group) in its own file and compose them with `.use()`. This keeps each file focused and avoids a single giant entry point.

```ts
// commands/deploy.ts
import { goke } from 'goke'
import { z } from 'zod'

export default goke()
  .command('deploy', 'Deploy the app')
  .option('--env <env>', z.enum(['staging', 'production']).describe('Target environment'))
  .option('--dry-run', 'Preview without deploying')
  .action((options, { console, process }) => {
    console.log(`Deploying to ${options.env} from ${process.cwd}`)
  })
```

```ts
// commands/auth.ts — multiple commands need a variable
import { goke } from 'goke'
import { z } from 'zod'

const auth = goke()

auth
  .command('login', 'Authenticate with the server')
  .option('--token [token]', z.string().describe('API token (skips browser login)'))
  .action(async (options, { fs, console }) => {
    const token = options.token ?? await browserOAuth()
    await fs.mkdir('.mycli', { recursive: true })
    await fs.writeFile('.mycli/auth.json', JSON.stringify({ token }), 'utf8')
    console.log('Logged in')
  })

auth
  .command('logout', 'Clear saved credentials')
  .action(async (options, { fs, console }) => {
    await fs.rm('.mycli/auth.json', { force: true })
    console.log('Logged out')
  })

export default auth
```

```ts
// cli.ts
import { goke } from 'goke'
import deploy from './commands/deploy.js'
import auth from './commands/auth.js'

const cli = goke('mycli')
  .use(deploy)
  .use(auth)

cli.help()
cli.completions()
cli.version('1.0.0')
cli.parse()
```

**Prefer this over importing just the action function.** When you define the command inline with goke, the action callback's types are computed automatically from the `.command()` and `.option()` chain. If you split the action into a separate function, you'd have to manually duplicate the option types to keep things in sync. With `.use(subCli)`, the types stay derived from the source of truth.

```ts
// BAD: duplicated types that can drift out of sync
import type { DeployOptions } from './types.js'
export function deployAction(options: DeployOptions) { /* ... */ }

// GOOD: types are always derived from the goke chain
export default goke()
  .command('deploy', 'Deploy')
  .option('--env <env>', z.enum(['staging', 'production']).describe('Environment'))
  .action((options) => {
    options.env // ← always in sync, inferred from the chain
  })
```

When `.use(subCli)` is called, only **commands** are composed into the parent. Middlewares and global options defined on the sub-CLI are not copied. Define shared middleware on the parent CLI instead.

### Global Options and Middleware

Global options are defined on the CLI instance and apply to all commands. Use `.use()` to register middleware that runs before any command action — useful for reacting to global options like setting up logging, initializing state, or configuring services.

Prefer the injected `{ fs, console, process }` argument over global `console`, `process.exit`, or direct `node:fs/promises` imports. It keeps commands easier to test and lets the same command code run inside alternate runtimes like JustBash.

`process.cwd`, `process.stdin`, and `process.env` come from the active runtime:

- In normal Node.js runs, `process.cwd` and `process.env` reflect the host process, while `process.stdin` defaults to an empty string unless you inject it yourself.
- In JustBash runs, those same fields are populated from the sandbox execution context.

Middleware runs in registration order, after option parsing and validation, but before the matched command's `.action()` callback.

### Filesystem Access

The injected `fs` object is the recommended way to read or write CLI state.

- In normal Node.js runs, `fs` defaults to `node:fs/promises`
- In JustBash runs, `goke` swaps in a compatible adapter over the JustBash virtual filesystem

This makes storage-style commands work in both environments without branching on runtime details.

```ts
cli
  .command('login', 'Save auth token')
  .option('--token <token>', z.string().describe('Auth token'))
  .action(async (options, { fs, console, process }) => {
    await fs.mkdir('.mycli', { recursive: true })
    await fs.writeFile('.mycli/auth.json', JSON.stringify({ token: options.token }), 'utf8')
    console.log('saved credentials in', process.cwd)
  })

cli
  .command('whoami', 'Read saved auth token')
  .action(async (options, { fs, console, process }) => {
    const auth = await fs.readFile('.mycli/auth.json', 'utf8')
    console.log(auth, process.env.USER)
  })
```

Prefer injected `fs` for CLI storage instead of importing `node:fs/promises` directly inside actions. That keeps the command portable to JustBash and easier to test.

### Path handling

Use relative paths with injected `fs` for routine CLI storage paths. When a helper needs to resolve from the current directory, pass injected `process.cwd` into that helper and resolve from there.

```ts
await fs.mkdir('.mycli', { recursive: true })
await fs.writeFile('.mycli/auth.json', json, 'utf8')
console.log('running from', process.cwd)
```

Why this works:

- In normal Node.js runs, relative paths resolve against the host cwd.
- In JustBash runs, the same relative paths resolve against the sandbox cwd.
- `process.cwd` mirrors that runtime-specific cwd in both environments.

`goke` also exports the runtime types, so helper functions can use dependency injection without reaching for globals:

```ts
import { goke } from 'goke'
import type { GokeFs, GokeProcess } from 'goke'

async function saveAuthToken(args: {
  fs: GokeFs
  process: GokeProcess
  token: string
}) {
  await args.fs.mkdir('.mycli', { recursive: true })
  await args.fs.writeFile('.mycli/auth.json', JSON.stringify({
    token,
    cwd: args.process.cwd,
  }), 'utf8')
}

const cli = goke('mycli')

cli
  .command('login <token>', 'Save auth token')
  .action(async (token, options, { fs, process, console }) => {
    await saveAuthToken({ fs, process, token })
    console.log('saved credentials')
  })
```

```ts
import { goke } from 'goke'
import { z } from 'zod'

const cli = goke('mycli')

cli
  .option('--verbose', z.boolean().default(false).describe('Enable verbose logging'))
  .option('--api-url [url]', z.string().default('https://api.example.com').describe('API base URL'))
  .use((options, { console, process }) => {
    // options.verbose and options.apiUrl are fully typed here
    if (options.verbose) {
      console.log('verbose mode enabled in', process.cwd)
    }
  })

cli
  .command('deploy <env>', 'Deploy to an environment')
  .option('--dry-run', 'Preview without deploying')
  .action((env, options, { console, process }) => {
    // options includes both command options (dryRun) and global options (verbose, apiUrl)
    console.log(`Deploying to ${env} via ${options.apiUrl} from ${process.cwd}`)
  })

cli
  .command('status', 'Show deployment status')
  .action((options, { console, process }) => {
    console.log('Checking status...', process.stdin)
  })

cli.help()
cli.completions()
cli.parse()
```

Type safety is positional — each `.use()` callback only sees options declared before it in the chain:

```ts
cli
  .option('--verbose', z.boolean().default(false).describe('Verbose'))
  .use((options, { process }) => {
    options.verbose   // boolean — typed
    process.argv      // string[] — typed
    process.cwd       // string — typed
    process.env       // Record<string, string> — typed
    process.stdin     // string — typed
    options.port      // TypeScript error — not declared yet
  })
  .option('--port <port>', z.number().describe('Port'))
  .use((options, { console, process }) => {
    options.verbose   // boolean — still visible
    options.port      // number — now visible
    console.error('ready', process.cwd)
  })
```

Middleware supports async functions. If any middleware is async, the remaining middleware and command action are chained as promises:

```ts
cli
  .option('--token <token>', z.string().describe('API token'))
  .use(async (options, { console, process }) => {
    const client = await connectToApi(options.token)
    globalState.client = client
    console.log('connected', process.env.NODE_ENV)
  })
```

### Command-specific Options

You can attach options to a command.

```ts
import { goke } from 'goke'

const cli = goke()

cli
  .command('rm <dir>', 'Remove a dir')
  .option('-r, --recursive', 'Remove recursively')
  .action((dir, options, { console, process }) => {
    console.log('remove ' + dir + (options.recursive ? ' recursively' : ''), process.cwd)
  })

cli.help()
cli.completions()

cli.parse()
```

### Space-separated Subcommands

goke supports multi-word command names for git-like nested subcommands:

```ts
import { goke } from 'goke'

const cli = goke('mycli')

cli.command('mcp login <url>', 'Login to MCP server').action((url, options, { console, process }) => {
  console.log('Logging in to', url, 'from', process.cwd)
})

cli.command('mcp logout', 'Logout from MCP server').action((options, { console, process }) => {
  console.log('Logged out', process.env.USER)
})

cli
  .command('git remote add <name> <url>', 'Add a git remote')
  .action((name, url, options, { console, process }) => {
    console.log('Adding remote', name, url, 'from', process.cwd)
  })

cli.help()
cli.completions()
cli.parse()
```

### Help Sections for Namespaced Commands

When commands share a parent word (`get pods`, `get services`, `auth login`), group them with `.section()`. Root help prints a heading for each group and adds extra space around those groups.

```ts
import { goke } from 'goke'

const cli = goke('kubectl')

cli.section('Get')
cli.command('get pods', 'List pods')
  .option('-o, --output <format>', 'Output format')
cli.command('get services', 'List services')
cli.command('get nodes', 'List nodes')

cli.section('Describe')
cli.command('describe pod <name>', 'Describe a pod')
cli.command('describe service <name>', 'Describe a service')

cli.help()
cli.completions()
cli.parse()
```

```txt
kubectl

Usage:
  $ kubectl <command> [options]

Commands:
  Get:
    get pods                 List pods
      -o, --output <format>  Output format

    get services             List services
    get nodes                List nodes

  Describe:
    describe pod <name>      Describe a pod
    describe service <name>  Describe a service

Options:
  -h, --help  Display this message
```

**Always call `.section()` before namespaced commands that share a parent.** Commands registered before any `.section()` stay ungrouped at the top. Use `.command(...).section('Name')` when one command belongs in a different group than the current CLI section.

### Schema-based Type Coercion

Pass a Standard Schema (like Zod) as the second argument to `.option()` for automatic type coercion. Description and default values are extracted from the schema:

```ts
import { goke } from 'goke'
import { z } from 'zod'

const cli = goke()

cli
  .command('serve', 'Start server')
  .option('--port <port>', z.number().describe('Port number'))
  .option('--host [host]', z.string().default('localhost').describe('Hostname'))
  .option('--workers <workers>', z.int().describe('Worker count'))
  .option('--tags <tag>', z.array(z.string()).describe('Tags (repeatable)'))
  .option('--verbose', 'Verbose output')
  .action((options, { console, process }) => {
    // options.port is number, options.host is string, etc.
    console.log(options, process.env.NODE_ENV)
  })

cli.parse()
```

**Important:** When using a schema with `.default()`, do **not** repeat the default in the description string. The framework automatically appends `(default: <value>)` to help output from the schema default. Writing `.default(100).describe('Number of lines (default: 100)')` would display the default twice.

The second argument accepts any object implementing [Standard Schema](https://github.com/standard-schema/standard-schema), including:

- **Zod** v4.2+ (e.g. `z.number()`, `z.string()`, `z.array(z.number())`)
- **Valibot**, **ArkType**, and other Standard Schema-compatible libraries

### Hiding Deprecated Options

Mark options as deprecated using Zod's `.meta({ deprecated: true })`. Deprecated options are hidden from help output but still work for parsing — useful for backward compatibility.

```ts
import { goke } from 'goke'
import { z } from 'zod'

const cli = goke()

cli
  .command('serve', 'Start server')
  // Deprecated option: hidden from --help, still parses
  .option('--old-port <port>', z.number().meta({ deprecated: true, description: 'Use --port instead' }))
  // Current option: visible in help
  .option('--port <port>', z.number().describe('Port number'))
  .action((options, { console, process }) => {
    const port = options.port ?? options.oldPort
    console.log('Starting on port', port, 'from', process.cwd)
  })

cli.help()
cli.completions()
cli.parse()
```

When users run `--help`, deprecated options won't appear, but `--old-port 3000` still works.

### Brackets

When using brackets in command name, angled brackets indicate required command arguments, while square brackets indicate optional arguments.

When using brackets in option name, angled brackets indicate that a string / number value is required, while square brackets indicate that the value is optional.

**Optionality is determined solely by bracket syntax, not by the schema.** `[square brackets]` makes an option optional regardless of whether the schema is `z.string()` or `z.string().optional()`. The schema's `.optional()` is never consulted for this — it only affects type coercion. This means `z.string()` with `[--name]` is treated as optional: if the flag is omitted, `options.name` is `undefined` even though the schema has no `.optional()`.

### Optional-value flags — `--flag` vs `--flag value` vs omitted

A flag declared with square brackets (`--host [host]`) has **three distinct runtime states**, not two. The user can:

1. **Omit the flag entirely** — no `--host` on the command line at all
2. **Pass the flag bare** — `--host` by itself, with no value following it
3. **Pass the flag with a value** — `--host example.com`

goke surfaces all three cases through a single `string | undefined` type. There is no `boolean` in the union — bare flags are normalized to the **empty string `''`** so callers only ever deal with strings:

```ts
cli
  .command('serve', 'Start the server')
  .option('--host [host]', 'Optional host override')
  .action((options) => {
    // options.host: string | undefined
    //   --host              → ''                (flag present, no value)
    //   --host example.com  → 'example.com'
    //   (omitted)           → undefined
  })
```

**Detecting each case:**

```ts
.action((options) => {
  if (options.host === undefined) {
    // Flag was not passed at all — use a sensible default
    console.log('using default host: localhost')
  } else if (options.host === '') {
    // Flag was passed bare: `--host` with no value following it
    // Treat this as an explicit "opt in, but use the default/automatic value"
    console.log('host flag passed with no value — enabling auto-discovery')
  } else {
    // Flag was passed with an explicit value
    console.log(`host = ${options.host}`)
  }
})
```

**In most cases you don't need the three-way distinction** — a plain truthy check collapses "omitted" and "bare flag" into the same "fall back to default" branch:

```ts
.action((options) => {
  // `--host` bare AND omitted both fall through to the default
  const host = options.host || 'localhost'
  startServer({ host })
})
```

Reserve the `=== ''` check for cases where "opt in without a value" is a meaningful signal distinct from "flag omitted" — for example, `--direct` meaning "auto-discover a Chrome instance" vs `--direct ws://…` meaning "connect to this specific endpoint" vs no `--direct` meaning "don't use direct mode".

> **Breaking change note (goke 6.6.0):** prior versions surfaced bare flags as `boolean` `true` inside a `string | boolean | undefined` union, forcing every call site to write `typeof options.host === 'string' ? options.host : undefined`. Code that used `options.host === true` to detect the bare-flag case must be updated to `options.host === ''`. Schema-based optional flags with `.default(...)` are unaffected — the default still kicks in when the flag is passed bare.

### Negated Options

To allow an option whose value is `false`, you need to manually specify a negated option:

```ts
cli
  .command('build [project]', 'Build a project')
  .option('--no-config', 'Disable config file')
  .option('--config <path>', 'Use a custom config file')
```

### Variadic Arguments

The last argument of a command can be variadic. To make an argument variadic you have to add `...` to the start of argument name:

```ts
cli
  .command('build <entry> [...otherFiles]', 'Build your app')
  .option('--foo', 'Foo option')
  .action((entry, otherFiles, options, { console, process }) => {
    console.log(entry)
    console.log(otherFiles)
    console.log(options, process.stdin)
  })
```

### Double-dash `--` (end of options)

The `--` token signals the end of options. Everything after `--` is available via `options['--']` as a separate array, not mixed into positional args. This lets you distinguish between your command's own arguments and passthrough args — the same pattern used by `doppler`, `npm`, `pnpm`, and `docker`.

`options['--']` is **always present** on the inferred options type as `string[]`. When no `--` token appears on the command line, it's the empty array — you never need to guard with `||` or `?.` or an `Array.isArray` cast.

```ts
import { goke } from 'goke'
import { z } from 'zod'
import { execSync } from 'child_process'

const cli = goke('runner')

cli
  .command('run <script>', 'Run a script with injected environment variables')
  .option('--env <env>', z.enum(['dev', 'staging', 'production']).describe('Target environment'))
  .example('# Pass extra flags to the child script via --')
  .example('runner run --env staging server.js -- --port 3000 --verbose')
  .action((script, options) => {
    // runner run --env staging server.js -- --port 3000 --verbose
    // script = 'server.js'           (positional arg)
    // options.env = 'staging'         (runner's own option)
    // options['--'] = ['--port', '3000', '--verbose']  (passthrough, always string[])

    const secrets = loadSecrets(options.env)
    const extraArgs = options['--'].join(' ')
    execSync(`node ${script} ${extraArgs}`, {
      env: { ...process.env, ...secrets },
      stdio: 'inherit',
    })
  })

cli.help()
cli.completions()
cli.parse()
```

```bash
runner run --env staging server.js -- --port 3000 --verbose
#          ^^^^^^^^^^^^  ^^^^^^^^^    ^^^^^^^^^^^^^^^^^^^^^^^^^
#          runner option  positional   passthrough (options['--'])
```

Without `--`, flags like `--port` would be parsed as runner options and fail with "Unknown option `--port`". The `--` tells goke to stop parsing and collect the rest separately.

### Dot-nested Options

Dot-nested options will be merged into a single option.

```ts
cli
  .command('build', 'desc')
  .option('--env <env>', 'Set envs')
  .example('--env.API_SECRET xxx')
  .action((options, { console, process }) => {
    console.log(options, process.env.API_SECRET)
  })
```

### Default Command

Register a command that will be used when no other command is matched.

```ts
cli
  .command('[...files]', 'Build files')
  .option('--minimize', 'Minimize output')
  .action((files, options, { console, process }) => {
    console.log(files)
    console.log(options.minimize, process.cwd)
  })
```

### Error Handling

To handle command errors globally:

```ts
cli.parse(process.argv).catch((error) => {
  const message = error instanceof Error ? error.stack : String(error)
  process.stderr.write(String(message) + '\n')
  process.exit(1)
})
```

### Process shutdown after actions

`parse()` resolves only after the matched command action and middleware finish. This makes it safe to add process shutdown code after parsing for CLIs that start background work, native handles, or long-running child processes during an action.

```ts
import { goke } from 'goke'

const cli = goke('render')

cli
  .command('screenshot <file>', 'Render a screenshot')
  .action(async (file, options, { console }) => {
    await renderScreenshot(file)
    console.log('saved screenshot')
  })

await cli.parse(process.argv)

// The command is done here. Use manual exit only for runtimes that leave
// background handles alive after the user-visible work has completed.
setTimeout(() => process.exit(0), 500).unref()
```

Put the forced exit **after** the awaited parse call, not inside the action. That avoids cutting off pending writes, logs, or cleanup that still belongs to the command.

### Testing with mocked console and exit

Because goke derives its injected `{ fs, console, process }` from the CLI's configured runtime dependencies, tests can override them directly and assert on the calls.

```ts
import { describe, expect, test, vi } from 'vitest'
import { goke, GokeProcessExit } from 'goke'

describe('deploy command', () => {
  test('writes output and exits with injected mocks', async () => {
    const stdout = { write: vi.fn<(data: string) => void>() }
    const stderr = { write: vi.fn<(data: string) => void>() }
    const exit = vi.fn<(code: number) => void>()

    const cli = goke('acme', { stdout, stderr, exit })

    cli
      .command('deploy', 'Deploy the project')
      .action((options, { console, process }) => {
        console.log('deploying')
        process.exit(2)
      })

    await expect(cli.parse(['node', 'acme', 'deploy'], { run: true }))
      .rejects.toThrow(GokeProcessExit)

    expect(stdout.write).toHaveBeenCalledWith('deploying\n')
    expect(exit).toHaveBeenCalledWith(2)
    expect(stderr.write).not.toHaveBeenCalled()
  })
})
```

### Testing a command action directly

Use `.getAction()` to extract the typed action callback from a command. This lets you call the action directly in tests without parsing argv, while keeping the action inline for type safety.

```ts
import { describe, expect, test, vi } from 'vitest'
import { goke } from 'goke'
import { z } from 'zod'

const cli = goke('mycli')

const deployCmd = cli
  .command('deploy', 'Deploy the app')
  .option('--env <env>', z.enum(['staging', 'production']).describe('Target environment'))
  .action((options, { console }) => {
    console.log(`Deploying to ${options.env}`)
  })

test('deploys to staging', () => {
  const stdout = { write: vi.fn<(data: string) => void>() }
  const action = deployCmd.getAction()
  action({ env: 'staging', '--': [] }, cli.createExecutionContext({ stdout }))
  expect(stdout.write).toHaveBeenCalledWith('Deploying to staging\n')
})
```

The returned function has the same typed signature as the `.action()` callback, so TypeScript catches wrong argument types at compile time. If no action was registered, `.getAction()` throws.

### With TypeScript

```ts
import { goke } from 'goke'

const cli = goke('my-program')
```

Do not manually type `action` callback arguments. goke infers argument and option types automatically from the command signature and option schemas.

```ts
import { goke } from 'goke'
import { z } from 'zod'

const cli = goke('my-program')

cli
  .command('serve <entry>', 'Start the app')
  .option('--port <port>', z.number().default(3000).describe('Port number'))
  .option('--watch', 'Watch files')
  .action((entry, options, { console, process }) => {
    // entry: string
    // options.port: number
    // options.watch: boolean
    console.log(entry, options.port, options.watch, process.cwd)
  })
```

### Open in Browser

`openInBrowser` opens a URL in the default browser. In non-TTY environments (CI, piped output, agents), it prints the URL to stderr instead, keeping stdout clean for JSON and structured output.

> **Important:** `openInBrowser` is async and must be awaited. Without `await`, the browser may not open before your process exits.

```ts
import { openInBrowser } from 'goke'

await openInBrowser('https://example.com/dashboard')
```

### Expose a goke CLI to JustBash

Use `cli.createJustBashCommand()` to expose a goke CLI as a single JustBash custom command. JustBash command names are single-token executables, but the goke CLI behind them can still use multi-word subcommands like `child commandwithspaces`.

```ts
import { goke } from 'goke'
import { z } from 'zod'
import { Bash } from 'just-bash'

const cli = goke('parent')

cli
  .command('child commandwithspaces', 'Run nested command')
  .option('--name <name>', z.string().describe('Name'))
  .action((options, { console, process }) => {
    console.log(`hello ${options.name} from ${process.cwd}`)
  })

const bash = new Bash({
  customCommands: [await cli.createJustBashCommand()],
})

await bash.exec('parent child commandwithspaces --name Tommy')
```

Prefer the injected `{ fs, console, process }` helpers in command implementations so the same command code works cleanly both in the regular CLI runtime and through the JustBash bridge. The injected `fs` defaults to Node `fs/promises`, and `process.cwd` / `process.env` / `process.stdin` reflect host values in Node but sandbox values inside `createJustBashCommand()`.

### Test with real JustBash

When a command reads or writes files, test it through real `just-bash` using the existing app CLI. Do not define the CLI inside the test body.

```ts
import { describe, expect, test } from 'vitest'
import { Bash, InMemoryFs } from 'just-bash'
import { cli } from '../src/cli'

describe('login command', () => {
  test('writes auth state through the sandbox fs', async () => {
    const virtualFs = new InMemoryFs()
    await virtualFs.mkdir('/project', { recursive: true })

    const bash = new Bash({
      fs: virtualFs,
      cwd: '/project',
      customCommands: [await cli.createJustBashCommand()],
    })

    const result = await bash.exec('parent login --token Tommy')

    expect(result.stdout).toBe('saved credentials\n')
    expect(await virtualFs.readFile('/project/.mycli/auth.json', 'utf8')).toBe(
      '{"token":"Tommy","cwd":"/project"}',
    )
  })
})
```

This is the recommended compatibility test whenever a CLI touches storage: run the same CLI once in normal tests and once through real `just-bash`.

### Exposing your CLI as a skill

If you build a CLI with goke, keep the skill minimal and point agents to the CLI help output. Put detailed usage in the CLI code and README, not in a duplicated skill file.

````markdown
<!-- skills/acme/SKILL.md -->
---
name: acme
description: >
  acme is a deployment CLI. Always run `acme --help` before using it
  to discover available commands, options, and usage examples.
---

# acme

Always run `acme --help` before using this CLI.
For subcommand details: `acme <command> --help`
````

## YAML Output for Agent-Friendly CLIs

When a command returns structured data, print it as YAML on stdout. YAML is the best middle ground between human-readable output and machine-processable output:

- Humans can read it at a glance — no surrounding quotes on keys, less punctuation noise than JSON.
- Agents can process it with [`yq`](https://github.com/mikefarah/yq), the YAML equivalent of `jq`, to extract specific fields or filter results.
- It is more context-efficient than verbose prose: a compact YAML block conveys the same information in fewer tokens.

```ts
import { goke } from 'goke'
import { stringify } from 'yaml'

const cli = goke('deploy')

cli
  .command('status', 'Show deployment status')
  .action(async (options, { console }) => {
    const status = await fetchStatus()
    // Output structured data as YAML on stdout
    console.log(stringify(status))
  })
```

Example output:

```yaml
deployment: prod-v2
status: running
replicas: 3
lastDeploy: "2026-01-15T10:30:00Z"
health:
  cpu: 42%
  memory: 1.2GB
```

### Processing YAML output with yq

Agents can pipe the output through `yq` to extract specific fields or filter results — the same way they would use `jq` with JSON, but with cleaner, more readable output:

```bash
# Extract a single field
deploy status | yq '.deployment'

# Access nested fields
deploy status | yq '.health.cpu'

# Filter an array of results
deploy list | yq '.[] | select(.status == "running")'

# Combine multiple fields
deploy list | yq '.[] | {name: .name, status: .status}'

# Count items matching a condition
deploy list | yq '[.[] | select(.status == "error")] | length'
```

### Keep stdout clean — send non-YAML to stderr

If a command outputs YAML on stdout, all unrelated content must go to stderr: error messages, progress indicators, informational logs, warnings. This keeps stdout pipeable through `yq` without breaking the YAML parse.

```ts
cli
  .command('deploy <env>', 'Deploy to environment')
  .action(async (env, options, { console }) => {
    // Progress and logs → stderr (won't pollute yq pipes)
    console.error(`Deploying to ${env}...`)
    console.error('Building artifacts...')

    const result = await deploy(env)

    // Structured result → stdout as YAML
    console.log(stringify(result))
  })
```

Now agents can process the output cleanly:

```bash
# Only the YAML result reaches yq — progress lines go to the terminal
deploy deploy production | yq '.version'
```

If an error occurs, throw or write to `console.error` / `process.stderr`, and exit with a non-zero code. Never mix error text into stdout when the command is expected to output YAML.

## Generating Markdown Docs

`generateDocs` creates markdown documentation pages for every command in your CLI. Each page includes a usage block, arguments table, options table, global options, and examples. You get back an array of `{ command, slug, content }` objects you can write to disk however you want.

This is useful to auto-generate docs for your CLI and feed them into documentation platforms like [Holocron](https://holocron.so) or [Mintlify](https://mintlify.com).

```ts
// scripts/generate-docs.ts
import { goke, generateDocs } from 'goke'
import { z } from 'zod'
import fs from 'node:fs'

const cli = goke('sentry')
  .version('1.0.0')
  .help()
  .completions()

cli
  .command('event view <id>', 'View details of a specific event')
  .option('-w, --web', 'Open in browser')
  .option('--spans <spans>', z.string().default('3').describe('Span tree depth limit'))
  .example('```\nsentry event view abc123\n```')

cli
  .command('event list <issue>', 'List events for an issue')
  .option('-n, --limit <limit>', z.number().default(25).describe('Number of events'))
  .option('-q, --query <query>', 'Search query')

const pages = generateDocs({ cli })

fs.mkdirSync('docs', { recursive: true })
for (const page of pages) {
  fs.writeFileSync(`docs/${page.slug}.md`, page.content)
  console.log(`wrote docs/${page.slug}.md`)
}
```

Running `npx tsx scripts/generate-docs.ts` produces files like `docs/index.md`, `docs/event-view.md`, `docs/event-list.md`. Each command page looks like this:

```md
# event view

View details of a specific event

## Usage

\```sh
sentry event view <id>
\```

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `<id>` | Yes | id |

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `-w, --web` | - | Open in browser |
| `--spans <spans>` | `3` | Span tree depth limit |

## Global Options

| Option | Default | Description |
|--------|---------|-------------|
| `-v, --version` | - | Display version number |
| `-h, --help` | - | Display this message |

## Examples

\```
sentry event view abc123
\```
```

The index page lists all commands with links:

```md
# sentry

Version: 1.0.0

## Commands

| Command | Description |
|---------|-------------|
| [`event view`](./event-view.md) | View details of a specific event |
| [`event list`](./event-list.md) | List events for an issue |

## Global Options

| Option | Default | Description |
|--------|---------|-------------|
| `-v, --version` | - | Display version number |
| `-h, --help` | - | Display this message |
```

Hidden commands and deprecated options are excluded automatically. Add this script to your CI or `package.json` scripts to keep docs in sync with the CLI code.

### `basePath`

By default the index page uses relative links (`./deploy.md`). Pass `basePath` to prefix all inter-page links with an absolute URL path, useful when docs are served under a nested route on your website.

```ts
// Pages will be served under /docs/cli/* on the website
const pages = generateDocs({ cli, basePath: '/docs/cli' })

// Index page links become: [deploy](/docs/cli/deploy.md)
// Without basePath, links are relative: [deploy](./deploy.md)
```

Default: `"."` (relative links).

## Contributor Notes

### Rules

1. Use schema-based options for typed values.
2. Do not repeat defaults in `.describe(...)` when using `.default()`.
3. Do not manually type action callback arguments; let goke infer them.
4. Prefer injected `{ fs, console, process }` over global `console`, `process.exit`, or direct `node:fs/promises` imports.
5. Use implicit cwd with injected `fs` for CLI storage. When a helper needs current-cwd semantics, pass `process.cwd` from the injected context into that helper.
6. Define the CLI in app code and import that same CLI in tests; do not construct a separate CLI inside compatibility tests.
7. **Keep actions inline.** Keep the action inline in the `.command().option().action()` chain. Extracting it into a separate function loses inferred type safety and forces you to duplicate the option/arg types manually. If a file gets too large, split into separate files that each export a `goke()` instance and compose them with `.use()`. See [Splitting a Large CLI into Files](#splitting-a-large-cli-into-files). To test an action directly, use `.getAction()` to extract the typed callback. See [Testing a command action directly](#testing-a-command-action-directly).

   ```ts
   // BAD: action in a separate function — types are lost, args/options duplicated
   projectsCli
     .command("projects list", "List all projects")
     .action((_options, ctx) => listProjectsAction(ctx));

   // GOOD: action inline — types inferred from the chain
   projectsCli
     .command("projects list", "List all projects")
     .action((_options, { console }) => {
       // implementation here, fully typed
     });

   // GOOD: split into files with .use() when commands get large
   // commands/projects.ts
   export default goke()
     .command("projects list", "List all projects")
     .action((_options, { console }) => {
       // implementation here
     });
   ```

### Version

Import `package.json` and use its version field so the CLI stays in sync automatically:

```ts
import pkg from './package.json' with { type: 'json' }

cli.version(pkg.version)
```

## References

### CLI Instance

CLI instance is created by invoking the `goke` function:

```ts
import { goke } from 'goke'
const cli = goke()
```

#### goke(name?)

Create a CLI instance, optionally specify the program name which will be used to display in help and version message. When not set we use the basename of `argv[1]`.

#### cli.command(name, description, config?)

- Type: `(name: string, description: string) => Command`

Create a command instance. Supports space-separated subcommands like `mcp login`.

- `config.allowUnknownOptions`: `boolean` Allow unknown options in this command.
- `config.ignoreOptionDefaultValue`: `boolean` Don't use the options's default value in parsed options, only display them in help message.

#### cli.option(name, descriptionOrSchema?)

- Type: `(name: string, descriptionOrSchema?: string | StandardJSONSchemaV1) => CLI`

Add a global option. The second argument is either:

- A **string** used as the description text
- A **Standard Schema** (e.g. `z.number().describe('Port')`) — description and default are extracted from the schema automatically

#### cli.use(callback)

- Type: `(callback: (options: Opts, { fs, console, process }) => void | Promise<void>) => CLI`

Register a middleware function that runs before the matched command action. Middleware runs in registration order, after option parsing and validation. The callback receives the parsed global options, typed according to all `.option()` calls that precede the `.use()` in the chain, plus an injected `{ fs, console, process }` helper object.

#### cli.use(subCli)

- Type: `(subCli: Goke) => CLI`

Compose commands from another goke instance into this CLI. All commands defined on `subCli` are merged into the parent. Middlewares and global options from the sub-CLI are **not** copied. See [Splitting a Large CLI into Files](#splitting-a-large-cli-into-files).

#### cli.parse(argv?)

- Type: `(argv = process.argv) => Promise<ParsedArgv>`

Parse argv, run the matched command by default, and resolve after async middleware and actions complete. Pass `{ run: false }` to parse and inspect args/options without running the matched command.

#### cli.version(version, customFlags?)

- Type: `(version: string, customFlags = '-v, --version') => CLI`

#### cli.help(callback?)

- Type: `(callback?: HelpCallback) => CLI`

#### cli.outputHelp()

- Type: `() => CLI`

Print the help message to stdout.

#### cli.clone(options?)

- Type: `(options?: GokeOptions) => Goke`

Create a deep copy of the CLI instance with all commands, options, middleware, and event listeners. Override any `GokeOptions` (stdout, stderr, cwd, env, fs, argv, columns, exit) in the clone without affecting the original. Primarily useful in tests to run multiple isolated parses from the same CLI definition:

```ts
const cli = goke('mycli')
cli.command('build', 'Build project').action((options, { console }) => {
  console.log('building')
})
cli.help()

// In tests: override streams without touching the original CLI
const stdout = { write: vi.fn<(data: string) => void>() }
const isolated = cli.clone({ stdout })
isolated.parse(['node', 'mycli', 'build'])
expect(stdout.write).toHaveBeenCalledWith('building\n')
```

#### cli.helpText()

- Type: `() => string`

Return the formatted help string without printing it. Useful for embedding help text in documentation, tests, or other programmatic uses.

#### generateDocs({ cli })

- Type: `(options: { cli: Goke }) => DocPage[]`

Generate markdown documentation pages for every non-hidden command. Returns an array of `{ command, slug, content }` objects. See [Generating Markdown Docs](#generating-markdown-docs) for full usage.

```ts
const cli = goke('mycli')
cli.command('build', 'Build project')
cli.option('--watch', 'Watch mode')
cli.help()

const help = cli.helpText()
// => "mycli\n\nUsage:\n  $ mycli ..."
```

#### cli.usage(text)

- Type: `(text: string) => CLI`

#### cli.example(example)

- Type: `(example: CommandExample) => CLI`

### Command Instance

#### command.option()

Basically the same as `cli.option` but this adds the option to specific command.

#### command.action(callback)

- Type: `(callback: ActionCallback) => Command`

Command callbacks receive positional args first, then parsed options, then an injected `{ fs, console, process }` object. Prefer those injected helpers over global `console`, `process.exit`, and direct `node:fs/promises` imports so commands stay easier to test and can run inside alternate runtimes like JustBash.

#### command.alias(name)

- Type: `(name: string) => Command`

#### command.allowUnknownOptions()

- Type: `() => Command`

#### command.hidden()

- Type: `() => Command`

Hide a command from the help output listing. The command still matches and runs when invoked directly — only the help display is suppressed. Useful for internal, deprecated, or experimental commands you don't want to advertise.

```ts
cli
  .command('internal-reset', 'Reset internal state')
  .hidden()
  .action((options, { console }) => {
    console.log('reset done')
  })
```

#### command.example(example)

- Type: `(example: CommandExample) => Command`

#### command.usage(text)

- Type: `(text: string) => Command`

#### command.helpText()

- Type: `() => string`

Return the formatted help string for this specific command without printing it. Useful for tests or embedding help text programmatically.

### Events

Listen to commands:

```js
cli.on('command:foo', () => {
  // Do something
})

cli.on('command:!', () => {
  // Default command
})

cli.on('command:*', () => {
  process.stderr.write(`Invalid command: ${cli.args.join(' ')}\n`)
  process.exit(1)
})
```

## Credits

goke is inspired by [cac](https://github.com/cacjs/cac) (Command And Conquer) by [EGOIST](https://github.com/egoist).

## License

MIT
