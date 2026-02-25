<div align='center'>
    <br/>
    <br/>
    <h3>goke</h3>
    <p>simple, type safe, elegant command line framework. CAC replacement</p>
    <br/>
    <br/>
</div>


## Features

- **Super light-weight**: No dependency, just a single file.
- **Easy to learn**. There are only 4 APIs you need to learn for building simple CLIs: `cli.option` `cli.version` `cli.help` `cli.parse`.
- **Yet so powerful**. Enable features like default command, git-like subcommands, validation for required arguments and options, variadic arguments, dot-nested options, automated help message generation and so on.
- **Space-separated subcommands**: Support multi-word commands like `mcp login`, `git remote add`.
- **Schema-based type coercion**: Use Zod, Valibot, ArkType, or plain JSON Schema for automatic type coercion and TypeScript type inference. Description and default values are extracted from the schema automatically.
- **Developer friendly**. Written in TypeScript.

## Install

```bash
npm install goke
```

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

cli.command('lint [...files]', 'Lint files').action((files, options) => {
  console.log(files, options)
})

cli
  .command('build [entry]', 'Build your app')
  .option('--minify', 'Minify output')
  .example('build src/index.ts')
  .example('build src/index.ts --minify')
  .action(async (entry, options) => { // options is type safe! no need to type it
    console.log(entry, options)
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
  .action((version, options) => {
    console.log('release', version, options)
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
  .action((options) => {
    console.log('migrate', options)
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
  .action((options) => {
    console.log(`Deploying to ${options.env}...`)
  })

// Subcommands
cli
  .command('init', 'Initialize a new project')
  .option('--template <template>', 'Project template')
  .action((options) => {
    console.log('Initializing project...')
  })

cli.command('login', 'Authenticate with the server').action(() => {
  console.log('Opening browser for login...')
})

cli.command('logout', 'Clear saved credentials').action(() => {
  console.log('Logged out')
})

cli
  .command('status', 'Show deployment status')
  .option('--json', 'Output as JSON')
  .action((options) => {
    console.log('Fetching status...')
  })

cli
  .command('logs <deploymentId>', 'Stream logs for a deployment')
  .option('--follow', 'Follow log output')
  .option('--lines <n>', z.number().default(100).describe('Number of lines'))
  .action((deploymentId, options) => {
    console.log(`Streaming logs for ${deploymentId}...`)
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

### Command-specific Options

You can attach options to a command.

```ts
import { goke } from 'goke'

const cli = goke()

cli
  .command('rm <dir>', 'Remove a dir')
  .option('-r, --recursive', 'Remove recursively')
  .action((dir, options) => {
    console.log('remove ' + dir + (options.recursive ? ' recursively' : ''))
  })

cli.help()

cli.parse()
```

### Space-separated Subcommands

goke supports multi-word command names for git-like nested subcommands:

```ts
import { goke } from 'goke'

const cli = goke('mycli')

cli.command('mcp login <url>', 'Login to MCP server').action((url) => {
  console.log('Logging in to', url)
})

cli.command('mcp logout', 'Logout from MCP server').action(() => {
  console.log('Logged out')
})

cli
  .command('git remote add <name> <url>', 'Add a git remote')
  .action((name, url) => {
    console.log('Adding remote', name, url)
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
  .action((options) => {
    // options.port is number, options.host is string, etc.
    console.log(options)
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
  .action((options) => {
    const port = options.port ?? options.oldPort
    console.log('Starting on port', port)
  })

cli.help()
cli.parse()
```

When users run `--help`, deprecated options won't appear, but `--old-port 3000` still works.

### Brackets

When using brackets in command name, angled brackets indicate required command arguments, while square brackets indicate optional arguments.

When using brackets in option name, angled brackets indicate that a string / number value is required, while square brackets indicate that the value can also be `true`.

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
  .action((entry, otherFiles, options) => {
    console.log(entry)
    console.log(otherFiles)
    console.log(options)
  })
```

### Dot-nested Options

Dot-nested options will be merged into a single option.

```ts
cli
  .command('build', 'desc')
  .option('--env <env>', 'Set envs')
  .example('--env.API_SECRET xxx')
  .action((options) => {
    console.log(options)
  })
```

### Default Command

Register a command that will be used when no other command is matched.

```ts
cli
  .command('[...files]', 'Build files')
  .option('--minimize', 'Minimize output')
  .action((files, options) => {
    console.log(files)
    console.log(options.minimize)
  })
```

### Error Handling

To handle command errors globally:

```ts
try {
  cli.parse(process.argv, { run: false })
  await cli.runMatchedCommand()
} catch (error) {
  console.error(error.stack)
  process.exit(1)
}
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
  .action((entry, options) => {
    // entry: string
    // options.port: number
    // options.watch: boolean
    console.log(entry, options.port, options.watch)
  })
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

#### cli.parse(argv?)

- Type: `(argv = process.argv) => ParsedArgv`

#### cli.version(version, customFlags?)

- Type: `(version: string, customFlags = '-v, --version') => CLI`

#### cli.help(callback?)

- Type: `(callback?: HelpCallback) => CLI`

#### cli.outputHelp()

- Type: `() => CLI`

#### cli.usage(text)

- Type: `(text: string) => CLI`

#### cli.example(example)

- Type: `(example: CommandExample) => CLI`

### Command Instance

#### command.option()

Basically the same as `cli.option` but this adds the option to specific command.

#### command.action(callback)

- Type: `(callback: ActionCallback) => Command`

#### command.alias(name)

- Type: `(name: string) => Command`

#### command.allowUnknownOptions()

- Type: `() => Command`

#### command.example(example)

- Type: `(example: CommandExample) => Command`

#### command.usage(text)

- Type: `(text: string) => Command`

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
  console.error('Invalid command: %s', cli.args.join(' '))
  process.exit(1)
})
```

## Credits

goke is inspired by [cac](https://github.com/cacjs/cac) (Command And Conquer) by [EGOIST](https://github.com/egoist).

## License

MIT
