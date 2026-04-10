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
cli.parse()
```

- **Hono-like chaining** — `.use()` for middleware, `.command()` for handlers. Build a CLI the same way you'd design a REST API.
- **Zod type safety** — pass a Zod schema to `.option()` and get automatic coercion, TypeScript inference, and help text for free. Works with Valibot, ArkType, or any Standard Schema library.
- **MCP server in 2 lines** — expose your entire CLI as an MCP server with `createMcpAction({ cli })`. Every command becomes a tool, ready for Claude Desktop, Cursor, VS Code, and [any MCP client](https://github.com/supermemoryai/install-mcp#supported-clients).
- **JustBash support** — `cli.createJustBashCommand()` exposes your CLI as a sandboxed JustBash command. Same action code, no changes needed.
- **Space-separated subcommands** — `git remote add`, `mcp login`, `db migrate` — multi-word commands work out of the box.
- **Injected `{ fs, console, process }`** — commands receive a portable runtime context. Swap it in tests, or let JustBash replace it with a sandbox. No global side effects.
- **Zero dependencies** — single file, no runtime deps.

## Install

```bash
npm install goke
```

## Install skill for AI agents

```bash
npx -y skills add remorses/goke
```

This installs the repository skill for AI coding agents. In this repo the shipped skill lives at `skills/goke/SKILL.md`.

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
cli.parse()
```

Why this pattern works well:

- `dedent` keeps template literals readable in source files.
- Help text stays aligned without extra leading whitespace.
- You can include rich formatting patterns users already recognize:
  lists, quotes, and inline command snippets.
- Long descriptions remain maintainable as your CLI grows.

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
cli.parse()
```

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
cli.parse()
```

When users run `--help`, deprecated options won't appear, but `--old-port 3000` still works.

### Brackets

When using brackets in command name, angled brackets indicate required command arguments, while square brackets indicate optional arguments.

When using brackets in option name, angled brackets indicate that a string / number value is required, while square brackets indicate that the value is optional.

**Optionality is determined solely by bracket syntax, not by the schema.** `[square brackets]` makes an option optional regardless of whether the schema is `z.string()` or `z.string().optional()`. The schema's `.optional()` is never consulted for this — it only affects type coercion. This means `z.string()` with `[--name]` is treated as optional: if the flag is omitted, `options.name` is `undefined` even though the schema has no `.optional()`.

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
    // options['--'] = ['--port', '3000', '--verbose']  (passthrough)

    const secrets = loadSecrets(options.env)
    const extraArgs = (options['--'] || []).join(' ')
    execSync(`node ${script} ${extraArgs}`, {
      env: { ...process.env, ...secrets },
      stdio: 'inherit',
    })
  })

cli.help()
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
try {
  cli.parse(process.argv, { run: false })
  await cli.runMatchedCommand()
} catch (error) {
  const message = error instanceof Error ? error.stack : String(error)
  process.stderr.write(String(message) + '\n')
  process.exit(1)
}
```

### Testing with mocked console and exit

Because goke derives its injected `{ fs, console, process }` from the CLI's configured runtime dependencies, tests can override them directly and assert on the calls.

```ts
import { describe, expect, test, vi } from 'vitest'
import { goke, GokeProcessExit } from 'goke'

describe('deploy command', () => {
  test('writes output and exits with injected mocks', () => {
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

    expect(() => {
      cli.parse(['node', 'acme', 'deploy'], { run: true })
    }).toThrow(GokeProcessExit)

    expect(stdout.write).toHaveBeenCalledWith('deploying\n')
    expect(exit).toHaveBeenCalledWith(2)
    expect(stderr.write).not.toHaveBeenCalled()
  })
})
```

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

`openInBrowser` opens a URL in the default browser. In non-TTY environments (CI, piped output, agents), it prints the URL to stdout instead.

```ts
import { openInBrowser } from 'goke'

openInBrowser('https://example.com/dashboard')
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

## Contributor Notes

### Rules

1. Use schema-based options for typed values.
2. Do not repeat defaults in `.describe(...)` when using `.default()`.
3. Do not manually type action callback arguments; let goke infer them.
4. Prefer injected `{ fs, console, process }` over global `console`, `process.exit`, or direct `node:fs/promises` imports.
5. Use implicit cwd with injected `fs` for CLI storage. When a helper needs current-cwd semantics, pass `process.cwd` from the injected context into that helper.
6. Define the CLI in app code and import that same CLI in tests; do not construct a separate CLI inside compatibility tests.

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

#### cli.parse(argv?)

- Type: `(argv = process.argv) => ParsedArgv`

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
