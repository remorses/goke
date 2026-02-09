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

// Display help message when `-h` or `--help` appears
cli.help()
// Display version number when `-v` or `--version` appears
cli.version('0.0.0')

cli.parse()
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

The second argument accepts any object implementing [Standard JSON Schema V1](https://github.com/standard-schema/standard-schema), including:

- **Zod** v4.2+ (e.g. `z.number()`, `z.string()`, `z.array(z.number())`)
- **Valibot**, **ArkType**, and other Standard Schema-compatible libraries
- **Plain JSON Schema** via `wrapJsonSchema({ type: "number", description: "Port" })`

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
