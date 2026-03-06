# goke

## 6.2.1

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
