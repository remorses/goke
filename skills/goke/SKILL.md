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

Fetch the full README from GitHub and read it before using goke:

```bash
curl -L https://raw.githubusercontent.com/remorses/goke/main/README.md
```

> Read the README in full every time you use goke.
>
> Important: never use `head` or `tail` to truncate it. Read the full README instead.

## Install

```bash
npm install goke # or bun, pnpm, etc
```

## Quick Notes

- Core APIs: `cli.option`, `cli.use`, `cli.version`, `cli.help`, `cli.completions`, `cli.parse`
- Prefer injected `{ fs, console, process }` over globals
- Use relative paths with injected `fs`; if a helper needs current-cwd semantics, pass injected `process.cwd` into that helper
- For JustBash compatibility tests, import the existing CLI from app code instead of defining a new CLI inside the test
- **Never install `picocolors`, `chalk`, `kleur`, or any color library.** Use `import { colors } from 'goke'` instead. It's a vendored picocolors with zero extra dependencies.

The README is the source of truth for rules, examples, testing patterns, JustBash integration, and API details.

## Terminal Colors

**Never install a separate color library.** goke vendors picocolors and exports it as `colors`:

```ts
import { colors } from 'goke'

console.log(colors.green('success'))
console.log(colors.red('error'))
console.log(colors.bold(colors.cyan('info')))
```

Available formatters: `bold`, `dim`, `italic`, `underline`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `gray`, `bgRed`, `bgGreen`, etc. Color support is auto-detected.

## Agent Detection

goke exports `isAgent`, `agent`, `agentInfo`, and `detectAgent()` from `goke/src/agents.ts`. Use `isAgent` to detect if the CLI is running inside an AI coding agent and skip interactive prompts or prefer structured output.

```ts
import { isAgent, agent } from 'goke'

if (isAgent) {
  // skip clack prompts, output YAML/JSON instead of interactive UI
}
```

When guarding interactive prompts, check `isAgent` alongside `!process.stdin.isTTY`:

```ts
if (isAgent || !process.stdin.isTTY) {
  console.error('Missing --env. Usage: deploy --env staging|production')
  process.exit(1)
}
```

Supported agents: `cursor`, `claude`, `devin`, `replit`, `gemini`, `codex`, `auggie`, `opencode`, `kiro`, `goose`, `pi`. Set `AI_AGENT` env var to override.

## Shell Completions

**Always add `.completions()` next to `.help()` in every CLI.** This gives users Tab completion for free.

```ts
cli.help()
cli.completions()
cli.parse()
```

### How it works

The shell calls the CLI binary on every Tab press with a hidden `--get-goke-completions` flag. The binary inspects registered commands and options, prints matching candidates to stdout, and exits. No static completion file to regenerate when commands change.

### README section for new CLIs

Every new CLI should include a **Shell Completions** section in its README. Add it after the main usage docs:

````md
## Shell Completions

Enable Tab completion for your shell:

```bash
mycli completions install
```

Restart your shell (or run `autoload -Uz compinit && compinit` for zsh). Then Tab works:

```bash
mycli <TAB>          # shows all commands
mycli dep<TAB>       # completes to "deploy"
mycli deploy --<TAB> # shows available options
```

Completions stay up-to-date automatically. To remove:

```bash
mycli completions uninstall
```
````

Replace `mycli` with the actual CLI name.

### Available completions commands

`.completions()` registers three subcommands:

- `completions install` — finds a writable shell completion directory and writes the shim script
- `completions uninstall` — removes installed completion files
- `completions script` — prints the raw script to stdout (for `eval` or piping)

All three accept `--shell zsh` or `--shell bash` to override auto-detection.

## openInBrowser is async

`openInBrowser` returns a `Promise<void>` and **must be awaited**. Without `await`, the process may exit before the browser opens. In non-TTY environments it writes the URL to stderr, keeping stdout clean for JSON parsing.

```ts
import { openInBrowser } from 'goke'

await openInBrowser('https://example.com/dashboard')
```

## Command Naming Conventions

**ALWAYS read existing commands before adding a new one.** Scan the CLI for option names, verbs, and noun patterns already in use. New commands must stay consistent with what exists.

### Consistent option names

Options that do the same thing across different commands must use the same name. For example, if `list` commands already use `--limit` to cap results, never introduce `--max` or `--count` for the same purpose in a new command. Grep the codebase for similar options before picking a name.

### CRUD-style spaced commands

Prefer spaced subcommands that read like `noun verb`:

```
project list
project add
project remove
```

Pick **singular or plural** for the noun and stick with it across the entire CLI. If `project list` exists, don't add `projects add`.

### Consistent verbs

Choose one verb per action and reuse it everywhere:

| Action | Pick one | Not both |
|--------|----------|----------|
| Create | `add` or `create` | not both |
| Delete | `remove` or `delete` | not both |
| Show   | `show` or `get` | not both |
| Update | `update` or `edit` | not both |

Check which verbs the CLI already uses and match them. If existing commands use `add`, every new "create something" command should also use `add`.

## Prefer Optional Flags Over Required Flags

**Never make a flag required when it can be optional with an interactive fallback.** Required flags force users to read `--help` before they can run anything. Optional flags let them run the bare command and discover options progressively through prompts.

The pattern: make the flag optional, and when the user omits it, show a `clack.select` prompt in TTY mode or exit with a clear error in non-TTY mode.

```ts
cli
  .command('deploy', 'Deploy the app')
  .option(
    '--env [env]',
    z.enum(['staging', 'production']).optional().describe('Target environment'),
  )
  .action(async (options) => {
    let env = options.env

    if (!env) {
      if (!process.stdin.isTTY) {
        console.error('Missing --env. Usage: deploy --env staging|production')
        process.exit(1)
      }

      const choice = await clack.select({
        message: 'Which environment?',
        options: [
          { value: 'staging', label: 'Staging' },
          { value: 'production', label: 'Production', hint: 'requires approval' },
        ],
      })
      if (clack.isCancel(choice)) {
        process.exit(0)
      }
      env = choice
    }

    // env is now guaranteed to be defined
  })
```

This applies to every flag that has a finite set of valid values. If you can enumerate the choices, make it a select prompt. The non-TTY error message must show the exact flag name and valid values so agents and CI scripts can self-correct.

**Bad** — forces users to know the flag upfront:

```ts
.option('--env <env>', z.enum(['staging', 'production']).describe('Target environment'))
```

**Good** — users can just run `deploy` and get prompted:

```ts
.option('--env [env]', z.enum(['staging', 'production']).optional().describe('Target environment'))
```

For flags with free-form string values (not enums), use `clack.text` instead of `clack.select`:

```ts
if (!options.name) {
  if (!process.stdin.isTTY) {
    console.error('Missing --name. Usage: create --name "my-project"')
    process.exit(1)
  }

  const name = await clack.text({ message: 'Project name' })
  if (clack.isCancel(name)) process.exit(0)
  options.name = name
}
```

## Interactive Prompts with @clack/prompts

Use `@clack/prompts` for interactive CLI prompts like `select`, `confirm`, and text input.

```bash
npm install @clack/prompts
```

```ts
import * as clack from '@clack/prompts'

const method = await clack.select({
  message: 'Choose authentication method',
  options: [
    { value: 'google', label: 'Google', hint: 'opens browser for OAuth' },
    { value: 'imap', label: 'Other', hint: 'IMAP/SMTP with password' },
  ],
})
if (clack.isCancel(method)) {
  process.exit(0)
}

const confirmed = await clack.confirm({
  message: 'Delete this item?',
  initialValue: false,
})
if (clack.isCancel(confirmed) || !confirmed) {
  process.exit(0)
}
```

Always guard clack prompts with `process.stdin.isTTY`. Agents and CI often run with non-TTY stdin, so interactive prompts must fall back to explicit CLI options instead of hanging.

### Select prompts

When a command shows a `select` prompt in TTY mode, always add a matching CLI option so agents can pass the choice directly.

```ts
cli
  .command('login', 'Authenticate')
  .option(
    '--method <method>',
    z.enum(['google', 'imap']).optional().describe('Authentication method'),
  )
  .action(async (options) => {
    let method = options.method

    if (!method) {
      if (!process.stdin.isTTY) {
        console.error('Run non-interactively with: zele login --method google|imap')
        process.exit(1)
      }

      const choice = await clack.select({
        message: 'Choose authentication method',
        options: [
          { value: 'google', label: 'Google', hint: 'opens browser for OAuth' },
          { value: 'imap', label: 'Other', hint: 'IMAP/SMTP with password' },
        ],
      })
      if (clack.isCancel(choice)) {
        process.exit(0)
      }
      method = choice
    }

    if (method === 'imap') {
      return
    }
  })
```

### Confirm prompts

For destructive confirmations, add a `--force` flag and exit with a clear error in non-TTY mode when it is missing.

```ts
cli
  .command('delete <id>', 'Delete an item')
  .option('--force', 'Skip confirmation')
  .action(async (id, options) => {
    if (!options.force) {
      if (!process.stdin.isTTY) {
        console.error('Use --force to delete non-interactively')
        process.exit(1)
      }

      const confirmed = await clack.confirm({
        message: `Delete ${id}?`,
        initialValue: false,
      })
      if (clack.isCancel(confirmed) || !confirmed) {
        return
      }
    }
  })
```

## Remote Server Auth & Config

CLIs that talk to a remote server must support multiple server URLs so users can self-host, use a preview/staging environment, or point to localhost during development. Auth tokens and other per-server state live in a JSON config file keyed by API URL.

### Config file location

Store config at `~/.cliname/config.json`. The directory is named after the CLI binary. Use `os.homedir()` to resolve `~`.

### Config structure

The config is an object keyed by server URL. Each entry holds auth tokens and any other per-server state. The CLI reads/writes only the entry matching the current `--api-url`.

```ts
// ~/.cliname/config.json
{
  "https://api.cliname.com": {
    "accessToken": "tok_abc123",
    "refreshToken": "rt_xyz789",
    "expiresAt": "2026-08-01T00:00:00Z"
  },
  "https://staging.cliname.com": {
    "accessToken": "tok_staging_456"
  },
  "http://localhost:3000": {
    "accessToken": "tok_dev_789"
  }
}
```

### Global `--api-url` option

Register `--api-url` as a global option with a default pointing to the production hosted service. Also support an env var (`CLINAME_API_URL` or similar) as a fallback. The option takes precedence over the env var, and both override the default.

```ts
import { goke } from 'goke'
import { z } from 'zod'

const DEFAULT_API_URL = 'https://api.cliname.com'

const cli = goke('cliname')

cli.option(
  '--api-url [url]',
  z.string().url().optional().describe('Server URL'),
)

cli.use((options) => {
  options.apiUrl = options.apiUrl
    || process.env.CLINAME_API_URL
    || DEFAULT_API_URL

  // normalize: strip trailing slash so keys are consistent
  options.apiUrl = options.apiUrl.replace(/\/+$/, '')
})
```

### Reading and writing config

```ts
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const CONFIG_DIR = path.join(os.homedir(), '.cliname')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

interface ServerConfig {
  accessToken?: string
  refreshToken?: string
  expiresAt?: string
}

type Config = Record<string, ServerConfig>

function loadConfig(): Config {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

function saveConfig(config: Config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n')
}

function getServerConfig(apiUrl: string): ServerConfig {
  return loadConfig()[apiUrl] ?? {}
}

function setServerConfig(apiUrl: string, data: ServerConfig) {
  const config = loadConfig()
  config[apiUrl] = { ...config[apiUrl], ...data }
  saveConfig(config)
}
```

### Using it in commands

Every command receives the resolved `apiUrl` from the middleware. Use it to load the right auth entry and make requests.

```ts
cli
  .command('login', 'Authenticate with the server')
  .action(async (options) => {
    const { apiUrl } = options
    // OAuth flow, API key prompt, etc.
    const token = await doLogin(apiUrl)
    setServerConfig(apiUrl, { accessToken: token })
    console.log(`Logged in to ${apiUrl}`)
  })

cli
  .command('status', 'Show current config')
  .action(async (options) => {
    const { apiUrl } = options
    const server = getServerConfig(apiUrl)
    console.log(`Server: ${apiUrl}`)
    console.log(`Authenticated: ${server.accessToken ? 'yes' : 'no'}`)
  })

cli
  .command('logout', 'Clear auth for current server')
  .action(async (options) => {
    const { apiUrl } = options
    const config = loadConfig()
    delete config[apiUrl]
    saveConfig(config)
    console.log(`Logged out from ${apiUrl}`)
  })
```

### Why key by URL

- Users can be logged in to production and staging simultaneously
- Self-hosters get isolated auth without conflicting with the hosted service
- Developers can point to `http://localhost:3000` during development without losing their production token
- Switching servers is just `--api-url` or setting an env var; no re-login needed if the server was used before
```
