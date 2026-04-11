# goke

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

   openInBrowser('https://example.com/dashboard')
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
