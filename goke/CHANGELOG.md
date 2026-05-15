# goke

## 6.11.0

**Default command no longer silently swallows unknown positional args.** When a CLI has a default command (`""`) that defines no positional args, passing args like `mycli run` now correctly falls through to the "unknown command" error instead of silently running the default action.

```ts
const cli = goke('playwriter')
cli.command('', 'Start the MCP server').action(async () => { ... })
cli.command('session new', 'Create session').action(() => { ... })
cli.help()
await cli.parse()

// `playwriter run` now shows "unknown command" instead of starting the server
// `playwriter` with no args still works
// `playwriter -- extra args` still works (passed via options["--"])
```

Default commands that define positional args like `command('[script]')` are unaffected and still accept arguments normally.

## 6.10.0

1. **Shell completion support (zsh + bash)** — generate and install shell completions for any goke CLI. Users get tab-completion for commands, subcommands, and options out of the box:

   ```ts
   const cli = goke('mycli')
     .help()
     .completions() // adds completions install/uninstall/script commands
     .parse()
   ```

   Install completions with:
   ```bash
   mycli completions install
   ```

   Completions are context-aware: they suggest subcommands after a matched prefix, filter options by what's already been typed, suppress aliases that were already used, and skip hidden commands. Zsh format includes `name:description` pairs for richer tab menus.

   Also exposes `getCompletions()` for programmatic use and `generateCompletionScript()` for custom installation flows.

2. **Agent detection module** — detect if the CLI is running inside an AI coding agent (Claude, Cursor, Codex, Gemini, Devin, etc.) by scanning environment variables:

   ```ts
   import { isAgent, agent, agentInfo } from 'goke'

   if (isAgent) {
     console.log(`Running inside ${agent}`) // e.g. "claude"
     // Skip interactive prompts, prefer structured output
   }
   ```

   Supports 11 agents with the `AI_AGENT` env var as override. Useful for skipping interactive prompts and browser opens when a CLI is invoked by an agent.

3. **New `generateDocs()` for programmatic markdown documentation** — generate markdown doc pages for every non-hidden command in a CLI:

   ```ts
   import { generateDocs } from 'goke'
   import { writeFileSync } from 'fs'

   const pages = generateDocs({ cli })
   for (const page of pages) {
     writeFileSync(`docs/${page.slug}.md`, page.content)
   }
   ```

   Each page includes usage, arguments table, options table (with defaults), and examples. Hidden commands and deprecated options are excluded automatically.

4. **New `getAction()` for testing command actions directly** — extract the typed action callback from a command without parsing argv:

   ```ts
   const cmd = cli.command('deploy', 'Deploy')
     .option('--env <env>', 'Environment')
     .action((options) => deploy(options.env))

   // In tests:
   const action = cmd.getAction()
   await action({ env: 'staging', '--': [] })
   ```

5. **Export vendored picocolors as `colors`** — use terminal colors without adding any color library to your dependencies:

   ```ts
   import { colors } from 'goke'
   console.log(colors.green('success'))
   ```

6. **`openInBrowser` is now async** — returns `Promise<void>` and must be awaited. The Node.js implementation uses non-blocking `exec` instead of `execSync`, so the calling thread is no longer blocked while the browser launches.

7. **Named anonymous action callbacks** — when you pass an inline arrow function to `.action()`, goke now sets its name to `command:<name>` (e.g. `command:deploy`) for better stack traces. Named functions are left untouched.

## 6.9.0

1. **New `.use(subCli)` for composing CLI instances across files** — split a large CLI into separate files, each exporting a `goke()` instance with its own commands, then compose them in the entry point:

   ```ts
   // commands/deploy.ts
   import { goke } from 'goke'
   export default goke()
     .command('deploy', 'Deploy the app')
     .option('--env <env>', z.enum(['staging', 'production']))
     .action((options) => { /* ... */ })

   // cli.ts
   import deploy from './commands/deploy.js'
   import auth from './commands/auth.js'

   const cli = goke('mycli')
     .use(deploy)
     .use(auth)

   cli.parse()
   ```

   Only commands are composed. Middlewares and global options from the sub-CLI are not copied, keeping composition predictable. Type safety is fully preserved: each sub-CLI command's `.action()` callback keeps its inferred types from the original `.command()`/`.option()` chain.

2. **JustBash output capture now respects `maxOutputSize` limits** — when a command produces output exceeding the configured `maxOutputSize`, the captured text is truncated and a `[output truncated]` notice is appended. Prevents memory issues with commands that produce large output.

## 6.8.0

1. **New public `cli.createExecutionContext(override?)`** — build the same injected context a command action sees from `cli.parse()`, but with per-call overrides. Adapters (MCP servers, batch runners, remote RPC, multi-tenant HTTP) can now construct a `GokeExecutionContext` with tenant-specific values without cloning or mutating the cli:

   ```ts
   import { GokeProcessExit } from 'goke'

   const stdout = createTextCaptureStream()
   const stderr = createTextCaptureStream()

   const ctx = cli.createExecutionContext({
     cwd: '/tenant-a/workspace',
     env: { TOKEN: 'user-token' },
     fs: tenantFs,        // any GokeFs-compatible filesystem adapter
     stdin: '',
     stdout,
     stderr,
     exit: () => {},      // throw-only: wrapper still throws GokeProcessExit
   })

   try {
     await action(positionalArg, options, ctx)
   } catch (err) {
     if (err instanceof GokeProcessExit) {
       // handle exit code — host process untouched
     }
   }

   console.log(stdout.text) // captured output from ctx.console.log
   ```

   Each field falls through to the cli's own configured value (set via `GokeOptions`), then to the real Node.js `process.*`. When `stdout` or `stderr` is overridden, a fresh `GokeConsole` is built from those streams so `ctx.console.log` routes through the override instead of the cli's cached console — preventing cross-request leaks.

   `runMatchedCommand()` is unchanged — it still calls `createExecutionContext()` with no arguments, so the `cli.parse()` path has zero behavior change.

2. **New exported type `GokeExecutionContextOverride`** — the typed override shape accepted by `createExecutionContext`. Import it for type-safe adapters:

   ```ts
   import type { GokeExecutionContextOverride } from 'goke'

   function buildTenantContext(tenantId: string): GokeExecutionContextOverride {
     return {
       cwd: `/workspaces/${tenantId}`,
       env: resolveTenantEnv(tenantId),
       fs: resolveTenantFs(tenantId),
       stdout: createCaptureStream(),
       stderr: createCaptureStream(),
       exit: () => {},
     }
   }
   ```

## 6.7.0

1. **Schemas with `.default(...)` now surface as required at the type level** — previously, a `[value]` option with a default still produced `options.foo: T | undefined` even though the runtime was always guaranteed to resolve the default. goke now detects this via a new `HasSchemaDefault<S>` type helper (Standard Schema `types.input` allows `undefined` but `types.output` doesn't) and emits the property as required:

   ```ts
   cli
     .command('list', 'List items')
     .option('--limit [n]', z.number().default(30).describe('Max items'))
     .option('--sort [mode]', z.enum(['asc', 'desc']).default('asc'))
     .action((options) => {
       // options.limit: number      (was: number | undefined)
       // options.sort:  'asc' | 'desc'  (was: 'asc' | 'desc' | undefined)
       // no `?? 30` / `?? 'asc'` fallbacks needed anymore
     })
   ```

   Works for Zod `.default(...)` and any Standard Schema library that populates `~standard.types.input = T | undefined` and `~standard.types.output = T`. The new inference is gated on `unknown extends Input` so hand-written schemas via `wrapJsonSchema<T>()` keep their existing bracket-based optionality.

2. **Runtime fix: bare `--flag` now preserves the schema default** — passing a schema-backed optional flag without a value (e.g. `mycli list --limit`) used to clobber the preset default with `undefined`. The runtime now detects this and keeps the default, so the type-level `HasSchemaDefault` promise holds for all three input states (omitted, bare, with-value). This is a small but meaningful runtime behavior change: if you previously relied on bare `--limit` producing `undefined` to trigger a different code path, you now need `z.number().default(30).optional()` or an untyped option.

3. **Schemas without defaults are unaffected** — `z.number()` on `[value]` still produces `number | undefined` (bracket syntax wins), and `.default(30).optional()` still produces `number | undefined` (the user explicitly opted back into optionality). Only Input-allows-undefined / Output-is-required schemas change.

## 6.6.2

1. **README now explains optional-value flag states** — added a dedicated "Optional-value flags" section walking through the three runtime states (omitted / bare / with value), how to detect each with `undefined` vs `''` vs truthy checks, and when the three-way distinction actually matters. Also updated the `--` passthrough example to use `options['--'].join(...)` directly (no `|| []` guard) now that the key is always typed as `string[]`. Docs-only release, no code changes.

## 6.6.1

1. **`wrapJsonSchema` now accepts an `Output` type parameter** — hand-written JSON Schemas can now flow a typed output all the way into `.action()` callbacks without any Zod dependency:

   ```ts
   cli
     .command('diff', 'Show diff')
     .option(
       '--filter <glob>',
       wrapJsonSchema<string[]>({
         type: 'array',
         items: { type: 'string' },
         description: 'Glob pattern (repeatable)',
       }),
     )
     .action((options) => {
       // options.filter: string[] | undefined
     })
   ```

   Previously the returned type defaulted to `StandardJSONSchemaV1` with `Output = unknown`, forcing every call site to cast. The default is still `unknown` when you omit the type parameter, so this is non-breaking for existing code.

## 6.6.0

1. **Optional-value flags now surface as `string | undefined`** — previously, a flag declared as `--host [host]` without a schema reached action callbacks as `string | boolean | undefined`, forcing every caller to write a boilerplate `typeof v === 'string' ? v : undefined` coercion. goke now normalizes the three states to a single clean shape:

   ```ts
   cli
     .command('serve', 'Start the server')
     .option('--host [host]', 'Optional host override')
     .action((options) => {
       // options.host: string | undefined
       //   --host              → ''         (flag present, no value)
       //   --host example.com  → 'example.com'
       //   (omitted)           → undefined
       if (options.host) console.log(`host = ${options.host}`)
     })
   ```

   Callers that need to distinguish "flag passed bare" from "flag omitted" can still do it via `=== undefined` vs `=== ''`, but the common case is now just a truthy check. **This is a breaking change** for code that treated `options.foo === true` as "bare flag" — replace with `options.foo === ''`.

   Schema-based optional-value flags are unchanged: `.option('--count [count]', z.number().default(30))` still returns `30` when `--count` is passed bare, so any defaults on the schema keep working.

2. **`options['--']` is now always present in action callback types** — every parsed options object already contained a `'--': string[]` entry at runtime (the array of args after a literal `--`), but the type only surfaced it if you cast. Action and middleware callbacks now see it typed directly:

   ```ts
   cli
     .command('run <script>', 'Run a script with passthrough args')
     .action((script, options) => {
       // options['--']: string[]
       //   goke run build -- --watch --coverage
       //   → options['--'] === ['--watch', '--coverage']
       console.log('passthrough:', options['--'])
     })
   ```

   No more `(options as Record<string, unknown>)['--']` casts in consumer code.

## 6.5.2

1. **Fixed: action callbacks are now fully typed without manual annotations** — positional args, command-local options, and global options are all inferred directly from the command definition. The README TypeScript examples now compile out of the box (closes [#1](https://github.com/remorses/goke/issues/1)):

   ```ts
   cli
     .command('serve <entry>', 'Start the app')
     .option('--port <port>', z.number().default(3000).describe('Port'))
     .option('--watch', 'Watch files')
     .action((entry, options, { console, process }) => {
       // entry: string — inferred from <entry>
       // options.port: number — inferred from z.number()
       // options.watch: boolean | undefined — inferred from boolean flag
       // no manual types needed
       console.log(entry, options.port, options.watch, process.cwd)
     })
   ```

   This works for all arg patterns — required `<arg>`, optional `[arg]`, variadic `[...files]` — and correctly propagates global options declared on the CLI instance into every command's `.action()` callback.

2. **Fixed: `openInBrowser` falls back to stdout (not stderr) in non-TTY environments** — when running in CI, piped output, or agent contexts, the URL is now written to stdout so it can be captured by scripts.

3. **Updated README** — new Hono-like framing, cleaner feature overview, and a new `## Features` heading to aid navigation.

## 6.5.1

1. **Removed the `picocolors` runtime dependency** — `goke` now vendors its color formatter internally, so installs stay more self-contained and avoid pulling an extra package into downstream dependency graphs.

2. **Improved agent and JustBash documentation** — the README now centralizes the goke guidance that used to be duplicated in the skill file, and includes the recommended `npx -y skills add remorses/goke` install flow plus the real JustBash compatibility-testing pattern.

## 6.5.0

1. **Injected filesystem access via `{ fs }` in actions and middleware** — command callbacks can now read and write files through a dependency-injected `fs` object instead of importing `node:fs/promises` directly:
   ```ts
   cli
     .command('login', 'Save auth token')
     .option('--token <token>', z.string().describe('Auth token'))
     .action(async (options, { fs, console, process }) => {
       await fs.mkdir('.mycli', { recursive: true })
       await fs.writeFile('.mycli/auth.json', JSON.stringify({ token: options.token }), 'utf8')
       console.log('saved credentials in', process.cwd)
     })
   ```
   In normal Node.js runs `fs` defaults to `node:fs/promises`. In JustBash sandboxes `goke` automatically swaps in a compatible adapter over the virtual filesystem, so the same command code works in both environments.

2. **Injected `process.cwd`, `process.env`, and `process.stdin`** — the runtime context now exposes the active working directory, environment, and standard input alongside existing `argv`, `stdout`, `stderr`, and `exit`:
   ```ts
   cli
     .command('deploy', 'Deploy the project')
     .action((options, { console, process }) => {
       console.log(`deploying from ${process.cwd}`)
       console.log(`NODE_ENV=${process.env.NODE_ENV}`)
     })
   ```
   In JustBash runs these fields reflect the sandbox `cwd`, `env`, and `stdin` rather than the host process. `process.env` is mutable — mutations persist in the underlying env object or sandbox `Map`.

3. **Exported `GokeFs` and `GokeProcess` types** — helper functions can now accept typed runtime objects for clean dependency injection without reaching for globals:
   ```ts
   import type { GokeFs, GokeProcess } from 'goke'

   async function saveAuth(args: { fs: GokeFs; process: GokeProcess; token: string }) {
     await args.fs.mkdir('.mycli', { recursive: true })
     await args.fs.writeFile('.mycli/auth.json', JSON.stringify({
       token: args.token,
       cwd: args.process.cwd,
     }), 'utf8')
   }
   ```

4. **JustBash bridge now wires the full sandbox process context** — `cli.createJustBashCommand()` now forwards sandbox `cwd`, `stdin`, `env`, and `fs` into the injected runtime context automatically, so storage-style CLIs work end-to-end inside a JustBash sandbox without any extra setup.

## 6.4.0

1. **Added injected `{ console, process }` runtime helpers for actions and middleware** — command callbacks can now write output and exit through dependency-injected runtime objects instead of reaching for globals:
   ```ts
   cli
     .command('deploy', 'Deploy the project')
     .action((options, { console, process }) => {
       console.log('deploying')
       process.exit(0)
     })
   ```
   This makes commands easier to test, keeps output portable across runtimes, and lets the same command implementation run cleanly in alternate environments.

2. **Added `cli.createJustBashCommand()`** — expose a goke CLI as a JustBash custom command while keeping support for multi-word goke subcommands:
   ```ts
   import { Bash } from 'just-bash'

   const bash = new Bash({
     customCommands: [await cli.createJustBashCommand()],
   })

   await bash.exec('parent child commandwithspaces --name Tommy')
   ```
   This also includes `cli.clone()` and `GokeProcessExit` so shared CLI instances can be reused safely with injected output and exit handling.

3. **Made the core package import-safe outside Node.js** — browser-like runtimes can now import `goke` without crashing on top-level Node globals, then provide their own `argv`, output streams, and `exit` handler manually:
   ```ts
   const cli = goke('mycli', {
     argv: ['browser', 'mycli', 'status'],
     stdout: { write(data) { logs.push(data) } },
     stderr: { write(data) { errors.push(data) } },
     exit(code) { throw new Error(`exit ${code}`) },
   })
   ```
   Node-specific runtime bindings now live behind package import conditions, with browser stubs for `process`, `EventEmitter`, and `openInBrowser()`.

## 6.3.2

1. **Added `.hidden()` on commands** — hide a command from help output while keeping it fully functional:
   ```ts
   cli.command('debug', 'Internal debug tool')
     .hidden()
     .action(() => { ... })
   ```
   Hidden commands don't appear in `--help` but still parse and run normally when invoked directly.

## 6.3.1

1. **Added `openInBrowser(url)`** — opens a URL in the default browser. In non-TTY environments (CI, piped output, agents), prints the URL to stderr instead of opening a browser:
   ```ts
   import { openInBrowser } from 'goke'

   await openInBrowser('https://example.com/dashboard')
   ```
   Use this after generating URLs (OAuth callbacks, dashboards, auth flows) so interactive users get a browser tab while non-interactive environments get a printable URL.

## 6.3.0

1. **Added `cli.use()` middleware** — register functions that run before any command action, after option parsing. Useful for reacting to global options (setting up logging, initializing clients, configuring services):
   ```ts
   cli
     .option('--verbose', z.boolean().default(false).describe('Enable verbose logging'))
     .use((options) => {
       if (options.verbose) process.env.LOG_LEVEL = 'debug'
     })
   ```

2. **Type-safe middleware callbacks** — `.use()` receives options typed from all `.option()` calls preceding it in the chain. Accessing an option not yet declared is a TypeScript error. Multiple middleware run in registration order:
   ```ts
   cli
     .option('--token <token>', z.string().describe('API token'))
     .use((options) => {
       options.token   // string — typed
       options.port    // TypeScript error — not declared yet
     })
     .option('--port <port>', z.number().describe('Port'))
     .use((options) => {
       options.token   // string
       options.port    // number
     })
   ```

3. **Async middleware supported** — if middleware returns a promise, the chain awaits it before proceeding to the next middleware or command action.

## 6.2.3

1. **Added `./src` and `./src/*` exports** — import directly from source TypeScript files without going through `dist`.
2. **Added package metadata** — `homepage`, `bugs`, `repository.directory`, and expanded `keywords` for better discoverability on npm.

## 6.2.0

1. **Added `cli.helpText()`** — returns the formatted help string without printing it. Useful for embedding help in docs, testing output, or passing to other tools:
   ```ts
   const help = cli.helpText()
   // includes ANSI color codes — strip with strip-ansi if you need plain text
   ```
2. **Deprecated options hidden from `--help`** — mark options with `.meta({ deprecated: true })` and they disappear from help output while still being parsed. Lets you gracefully phase out flags without breaking existing scripts:
   ```ts
   cli.option('--old-flag <v>', z.string().meta({ deprecated: true }))
   ```
3. **Formatted error output** — CLI errors (unknown option, missing value, wrong type) now print a clean `error: ...` message to stderr with a help hint instead of a raw Node.js stack trace:
   ```
   error: Unknown option `--typo`
   Run "mycli build --help" for usage information.
   ```
4. **Help output visual improvements** — command names now use green, option flags use blue (was orange/yellow). Sections and command groups have more breathing room.

## 6.1.3

- Fix: show root help when the CLI is invoked with no args and no default `''` command is defined
- Fix: show root help for unknown commands that do not match any command-prefix help group
- Test: add regression coverage for empty invocation and unknown non-prefix command help behavior

## 6.1.2

- Build: clean `dist` before compiling to prevent stale declaration artifacts
- Publish: run `prepublishOnly` through the build pipeline so publish always starts from a clean output directory

## 6.1.1

- Fix: use Infinity as default help width fallback when terminal columns are unavailable, avoiding forced wrapping in non-TTY environments
- Test: add inline snapshot coverage for root `--help` output when `process.stdout.columns` is undefined

## 6.1.0

- Feat: redesign help rendering with wrapped full descriptions and colorized sections
- Feat: support prefix-scoped help for partial subcommands
- Refactor: simplify option API to accept schema as second argument (Breaking Change)

## 6.0.7

- Fix: default command should not match when args prefix another command

## 6.0.6

- Feat: Description section below Options, first-line in commands listing

## 6.0.5

- Feat: add Description section for specific command help

## 6.0.2

- Feat: add Description section for command help
- Feat: space-separated subcommands support (e.g. `mcp login`, `git remote add`)
