---
name: goke
description: >
  goke is a zero-dependency, type-safe CLI framework for TypeScript. CAC replacement
  with Standard Schema support (Zod, Valibot, ArkType). Use goke when building CLI
  tools — it handles commands, subcommands, options, type coercion, help generation,
  and more. Schema-based options give you automatic type inference, coercion from
  strings, and help text generation. ALWAYS read this skill when a repo uses goke
  for its CLI.
version: 0.0.1
---

# goke

Zero-dependency, type-safe CLI framework for TypeScript. A CAC replacement with Standard Schema support.

4 core APIs: `cli.option`, `cli.version`, `cli.help`, `cli.parse`.

```ts
import { goke } from 'goke'
import { z } from 'zod'

const cli = goke('mycli')

cli
  .command('serve', 'Start the dev server')
  .option('--port <port>', z.number().default(3000).describe('Port to listen on'))
  .option('--host [host]', z.string().default('localhost').describe('Hostname to bind'))
  .option('--open', 'Open browser on start')
  .action((options) => {
    // options.port: number, options.host: string, options.open: boolean
    console.log(options)
  })

cli.help()
cli.version('1.0.0')
cli.parse()
```

## Version

Import `package.json` with `type: 'json'` and use the `version` field:

```ts
import pkg from './package.json' with { type: 'json' }

cli.version(pkg.version)
```

This works in Node.js and keeps the version in sync with `package.json` automatically.

## Rules

1. Always use schema-based options (Zod, Valibot, etc.) for typed values — without a schema, all values are raw strings
2. **Never add `(default: X)` in the description string** when using `.default()` — goke extracts the default from the schema and appends it to help output automatically. Adding it in the description shows the default twice
3. Don't manually type `action` callback arguments — goke infers argument and option types automatically from the command signature and option schemas
4. Use `<angle brackets>` for required values, `[square brackets]` for optional values — this applies to both command arguments and option values
5. Use `z.array()` for options that can be passed multiple times (repeatable flags)
6. Use `z.enum()` for options constrained to a fixed set of values
7. Write very detailed descriptions for commands and options — agents and users rely on `--help` output as documentation. Include what the option does, when to use it, and examples if relevant
8. Add `.example()` to commands to show usage patterns in help output — use a `#` comment as the first line to explain the scenario
9. Options without brackets are boolean flags (`--verbose` → `true`/`false`)
10. Kebab-case options are auto-camelCased in the parsed result (`--max-retries` → `options.maxRetries`)

## Schema-based options

Pass a Standard Schema (Zod, Valibot, ArkType) as the second argument to `.option()` for automatic type coercion. Description, default, and deprecated flag are extracted from the schema.

### Typed values

```ts
// number — string "3000" coerced to number 3000
.option('--port <port>', z.number().describe('Port number'))

// integer — rejects decimals like "3.14"
.option('--workers <n>', z.int().describe('Number of worker threads'))

// string — preserves value as-is (no auto-conversion)
.option('--name <name>', z.string().describe('Project name'))

// boolean value option — accepts "true" or "false" strings
.option('--flag <flag>', z.boolean().describe('Enable feature'))
```

### Default values

Use `.default()` on the schema. The default is shown in help output automatically.

```ts
// Port defaults to 3000 if not passed
.option('--port [port]', z.number().default(3000).describe('Port to listen on'))

// Host defaults to "localhost"
.option('--host [host]', z.string().default('localhost').describe('Hostname to bind'))
```

**Important:** use `[optional]` brackets when the option has a default — `<required>` brackets throw an error when the value is missing, even if a default exists.

Help output for the above:

```
--port [port]  Port to listen on (default: 3000)
--host [host]  Hostname to bind (default: localhost)
```

The `(default: 3000)` is appended automatically. Never write `.default(3000).describe('Port to listen on (default: 3000)')` — this would display the default twice.

### Enum options (constrained values)

Use `z.enum()` for options that only accept specific values:

```ts
.option('--format <format>', z.enum(['json', 'yaml', 'csv']).describe('Output format'))
.option('--env <env>', z.enum(['dev', 'staging', 'production']).describe('Target environment'))
```

Invalid values throw a clear error: `expected one of "json", "yaml", "csv", got "xml"`.

### Repeatable options (arrays)

Use `z.array()` to allow passing the same flag multiple times:

```ts
// Pass --tag multiple times: --tag foo --tag bar → ["foo", "bar"]
.option('--tag <tag>', z.array(z.string()).describe('Tags (repeatable)'))

// Typed array items: --id 1 --id 2 → [1, 2] (numbers, not strings)
.option('--id <id>', z.array(z.number()).describe('IDs (repeatable)'))
```

The optimal way for users to pass array values is repeating the flag:

```bash
mycli deploy --tag v2.1.0 --tag latest --tag rollback
# → tags: ["v2.1.0", "latest", "rollback"]
```

A single value is automatically wrapped: `--tag foo` → `["foo"]`.

JSON array strings also work but are less ergonomic: `--ids '[1,2,3]'` → `[1, 2, 3]`.

**Non-array schemas reject repeated flags.** If a user passes `--port 3000 --port 4000` with a `z.number()` schema, goke throws `does not accept multiple values`.

### Nullable options

```ts
// Pass empty string "" to get null, or a number
.option('--timeout <timeout>', z.nullable(z.number()).describe('Timeout in ms, empty for none'))
```

### Union types

```ts
// Tries number first, falls back to string
.option('--val <val>', z.union([z.number(), z.string()]).describe('A number or string value'))
```

### Deprecated options (hidden from help)

Use `.meta({ deprecated: true })` to hide options from `--help` while still parsing them:

```ts
.option('--old-port <port>', z.number().meta({ deprecated: true, description: 'Use --port instead' }))
.option('--port <port>', z.number().describe('Port number'))
```

### No schema = raw strings

Without a schema, all values stay as strings. `--port 3000` → `"3000"` (string, not number). Use schemas for type safety.

## Brackets

| Syntax | Meaning |
|--------|---------|
| `<name>` in command | Required argument |
| `[name]` in command | Optional argument |
| `[...files]` in command | Variadic (collects remaining args into array) |
| `<value>` in option | Required value (error if missing) |
| `[value]` in option | Optional value (`true` if flag present without value) |
| no brackets in option | Boolean flag (`--verbose` → `true`) |

## Commands

### Basic commands with arguments

```ts
cli
  .command('deploy <env>', 'Deploy to an environment')
  .option('--dry-run', 'Preview without deploying')
  .action((env, options) => {
    // env: string, options.dryRun: boolean
  })
```

### Root command (runs when no subcommand given)

Use empty string `''` as the command name:

```ts
// `mycli` runs the root command, `mycli status` runs the subcommand
cli
  .command('', 'Deploy the current project')
  .option('--env <env>', z.string().default('production').describe('Target environment'))
  .action((options) => {})

cli.command('status', 'Show deployment status').action(() => {})
```

### Space-separated subcommands

For git-like nested commands:

```ts
cli.command('mcp login <url>', 'Login to MCP server').action((url) => {})
cli.command('mcp logout', 'Logout from MCP server').action(() => {})
cli.command('git remote add <name> <url>', 'Add a git remote').action((name, url) => {})
```

Greedy matching: `mcp login` matches before `mcp` when both exist.

### Variadic arguments

The last argument can be variadic with `...` prefix:

```ts
cli
  .command('build <entry> [...otherFiles]', 'Build your app')
  .action((entry, otherFiles, options) => {
    // entry: string, otherFiles: string[]
  })
```

### Command aliases

```ts
cli.command('install', 'Install packages').alias('i').action(() => {})
// Now both `mycli install` and `mycli i` work
```

## Writing detailed help text

Agents and users rely on `--help` as the primary documentation for a CLI. Write descriptions that are thorough and actionable.

### Detailed command descriptions

Use `string-dedent` for multi-line descriptions:

```ts
import dedent from 'string-dedent'

cli
  .command(
    'release <version>',
    dedent`
      Publish a versioned release to distribution channels.

      - Validates release metadata and changelog before publishing.
      - Builds production artifacts with reproducible settings.
      - Tags git history using semantic version format.
      - Publishes to npm and creates release notes.

      > Recommended: run with --dry-run first in CI to verify output.
    `,
  )
  .option('--channel <name>', z.enum(['stable', 'beta', 'alpha']).describe('Target release channel'))
  .option('--dry-run', 'Preview every step without publishing')
  .action((version, options) => {})
```

### Detailed option descriptions

Write descriptions that tell the user exactly what the option does:

```ts
// Bad — too terse
.option('--limit [limit]', z.number().default(10).describe('Limit'))

// Good — tells what it does, what values are valid
.option('--limit [limit]', z.number().default(10).describe('Maximum number of results to return'))
```

### Examples in help output

Add `.example()` to commands. Use `#` comments to explain the scenario:

```ts
cli
  .command('deploy', 'Deploy current app')
  .option('--env <env>', z.enum(['staging', 'production']).describe('Target environment'))
  .example('# Deploy to staging first')
  .example('mycli deploy --env staging')
  .example('# Then deploy to production')
  .example('mycli deploy --env production')
  .action(() => {})
```

Root-level examples:

```ts
cli.example((bin) => `${bin} deploy --env production`)
```

## Boolean flags

Options without brackets are boolean flags:

```ts
.option('--verbose', 'Enable verbose output')     // --verbose → true
.option('--no-cache', 'Disable caching')           // --no-cache → true (negated option)
```

## Dot-nested options

```ts
cli.option('--env <env>', 'Set envs')
// --env.API_SECRET xxx → options.env = { API_SECRET: 'xxx' }
```

## Short aliases

```ts
.option('-p, --port <port>', z.number().describe('Port number'))
// -p 3000 and --port 3000 both work
// options.port and options.p both equal 3000
```

## Injectable I/O (testing)

Override stdout, stderr, argv, and exit for testing:

```ts
import goke, { createConsole } from 'goke'

const stdout = { lines: [], write(data) { this.lines.push(data) } }
const cli = goke('mycli', {
  stdout,
  stderr: process.stderr,
  exit: () => {},  // prevent process.exit in tests
})
```

## @goke/mcp — turn MCP servers into CLIs

`@goke/mcp` auto-discovers tools from an MCP server and registers them as CLI commands with typed options from JSON Schema:

```ts
import { goke } from 'goke'
import { addMcpCommands } from '@goke/mcp'

const cli = goke('mycli')

await addMcpCommands({
  cli,
  getMcpUrl: () => 'https://your-mcp-server.com/mcp',
  oauth: {
    clientName: 'My CLI',
    load: () => loadConfig().oauthState,
    save: (state) => saveConfig({ oauthState: state }),
  },
  loadCache: () => loadConfig().cache,
  saveCache: (cache) => saveConfig({ cache }),
})

cli.help()
cli.parse()
```

Tools are cached for 1 hour. OAuth is lazy — triggered only on 401 errors.

## Complete example

```ts
import { goke } from 'goke'
import { z } from 'zod'
import dedent from 'string-dedent'

const cli = goke('acme')

cli
  .command('', 'Run the default workflow')
  .option('--env [env]', z.string().default('development').describe('Target environment'))
  .action((options) => {
    console.log(`Running in ${options.env}`)
  })

cli
  .command(
    'deploy <target>',
    dedent`
      Deploy the application to a target environment.

      - Builds optimized production bundle.
      - Uploads artifacts to the target.
      - Runs post-deploy health checks.

      > Always deploy to staging first before production.
    `,
  )
  .option('--env <env>', z.enum(['staging', 'production']).describe('Deployment environment'))
  .option('--tag <tag>', z.array(z.string()).describe('Docker image tags to deploy (repeatable)'))
  .option('--workers <n>', z.int().default(4).describe('Number of parallel upload workers'))
  .option('--timeout [ms]', z.number().default(30000).describe('Deployment timeout in milliseconds'))
  .option('--dry-run', 'Preview the deployment plan without executing')
  .option('--verbose', 'Enable detailed deployment logging')
  .example('# Deploy to staging with custom tags')
  .example('acme deploy web --env staging --tag v2.1.0 --tag latest')
  .example('# Dry-run production deploy')
  .example('acme deploy api --env production --dry-run --verbose')
  .action((target, options) => {
    console.log('deploying', target, options)
  })

cli
  .command('db migrate', 'Apply pending database migrations in sequence')
  .option('--target <migration>', z.string().describe('Apply up to a specific migration ID'))
  .option('--dry-run', 'Print SQL plan without executing')
  .option('--verbose', 'Show each executed SQL statement')
  .action((options) => {
    console.log('migrating', options)
  })

cli
  .command('config set <key> <value>', 'Set a configuration value')
  .action((key, value) => {
    console.log('setting', key, value)
  })

cli.help()
cli.version('1.0.0')
cli.parse()
```

## Exposing your CLI as a skill

When you build a CLI with goke, the optimal way to create a skill for it is a minimal SKILL.md that tells agents to run `--help` before using the CLI. This way descriptions, examples, and usage patterns live in the CLI code (collocated with the implementation) instead of a separate markdown file that can go stale.

Example SKILL.md for a CLI built with goke:

````markdown
---
name: acme
description: >
  acme is a deployment CLI. Always run `acme --help` before using it
  to discover available commands, options, and usage examples.
---

# acme

Always run `acme --help` before using this CLI. The help output contains
all commands, options, defaults, and usage examples.

For subcommand details: `acme <command> --help`
````

This is the recommended pattern because:
- Descriptions and examples are defined once in `.option()` and `.example()` calls
- Help output always matches the actual CLI behavior
- No separate documentation to maintain or keep in sync
