/**
 * Goke — a cac-inspired CLI framework.
 *
 * This file contains the entire core framework:
 * - Option: CLI option parsing (flags, required/optional values)
 * - Command / GlobalCommand: command definition, help/version output
 * - Goke: main CLI class with parsing, matching, and execution
 * - GokeOutputStream / GokeConsole / GokeOptions: injectable I/O
 * - createConsole: factory for console-like objects from output streams
 * - Utility functions: string helpers, bracket parsing, dot-prop access
 */

import pc from './picocolors.js'
import mri from "./mri.js"
import { GokeError, coerceBySchema, extractJsonSchema, extractSchemaMetadata, isStandardSchema } from "./coerce.js"
import type { StandardJSONSchemaV1 } from "./coerce.js"
import { createJustBashCommand as createJustBashCommandBridge } from './just-bash.js'
import { COMPLETION_FLAG, generateCompletionScript, installCompletions, uninstallCompletions, detectShell, detectCompletionShell, validateShell } from './completions.js'
import type { ShellType } from './completions.js'
import type { GokeFs } from './goke-fs.js'
import { EventEmitter, fs as runtimeFs, openInBrowser, process } from '#runtime'

// ─── Node.js platform constants ───

const processArgs = process.argv
const platformInfo = `${process.platform}-${process.arch} node-${process.version}`

// ─── Utility functions ───

const removeBrackets = (v: string) => v.replace(/[<[].+/, '').trim()

const findAllBrackets = (v: string) => {
  const ANGLED_BRACKET_RE_GLOBAL = /<([^>]+)>/g
  const SQUARE_BRACKET_RE_GLOBAL = /\[([^\]]+)\]/g

  const res: CommandArg[] = []

  const parse = (match: string[]) => {
    let variadic = false
    let value = match[1]
    if (value.startsWith('...')) {
      value = value.slice(3)
      variadic = true
    }
    return {
      required: match[0].startsWith('<'),
      value,
      variadic
    }
  }

  let angledMatch
  while ((angledMatch = ANGLED_BRACKET_RE_GLOBAL.exec(v))) {
    res.push(parse(angledMatch))
  }

  let squareMatch
  while ((squareMatch = SQUARE_BRACKET_RE_GLOBAL.exec(v))) {
    res.push(parse(squareMatch))
  }

  return res
}

interface MriOptionsConfig {
  alias: { [k: string]: string[] }
  boolean: string[]
}

const getMriOptions = (options: Option[]) => {
  const result: MriOptionsConfig = { alias: {}, boolean: [] }

  for (const option of options) {
    // We do not set default values in mri options
    // Since its type (typeof) will be used to cast parsed arguments.
    // Which mean `--foo foo` will be parsed as `{foo: true}` if we have `{default:{foo: true}}`

    // Set alias
    if (option.names.length > 1) {
      result.alias[option.names[0]] = option.names.slice(1)
    }
    // Set boolean
    if (option.isBoolean) {
      result.boolean.push(option.names[0])
    }
  }

  return result
}

const maxVisibleLength = (arr: string[]) => {
  return arr.reduce((max, value) => {
    return Math.max(max, visibleLength(value))
  }, 0)
}

const ANSI_RE = /\x1B\[[0-9;]*m/g

const visibleLength = (value: string) => value.replace(ANSI_RE, '').length

const commandGreen = (value: string) => pc.bold(pc.cyanBright(value))

const optionBlue = (value: string) => pc.bold(pc.blueBright(value))

const padRight = (str: string, length: number) => {
  return visibleLength(str) >= length ? str : `${str}${' '.repeat(length - visibleLength(str))}`
}

const wrapLine = (line: string, width: number) => {
  if (width <= 0 || visibleLength(line) <= width) {
    return [line]
  }

  const words = line.trim().split(/\s+/)
  const wrapped: string[] = []
  let current = ''

  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (visibleLength(next) <= width) {
      current = next
      continue
    }

    if (current) {
      wrapped.push(current)
    }

    if (visibleLength(word) <= width) {
      current = word
      continue
    }

    let remaining = word
    while (visibleLength(remaining) > width) {
      wrapped.push(remaining.slice(0, width))
      remaining = remaining.slice(width)
    }
    current = remaining
  }

  if (current) {
    wrapped.push(current)
  }

  return wrapped
}

const wrapDescription = (text: string, width: number) => {
  const maxWidth = Math.max(20, width)
  return text
    .split('\n')
    .flatMap((line) => {
      if (line.trim() === '') {
        return ['']
      }
      return wrapLine(line, maxWidth)
    })
}

const formatWrappedDescription = (text: string, width: number, indent: number) => {
  const lines = wrapDescription(text, width)
    .map((line) => (line ? pc.dim(line) : line))
  if (lines.length === 0) {
    return ''
  }
  return [
    lines[0],
    ...lines.slice(1).map((line) => `${' '.repeat(indent)}${line}`),
  ].join('\n')
}

const optionDescriptionText = (option: Option) => {
  const defaultText = option.default === undefined
    ? ''
    : ` ${pc.cyan(`(default: ${String(option.default)})`)}`
  return `${option.description}${defaultText}`.trim()
}

const camelcase = (input: string) => {
  return input.replace(/([a-z])-([a-z])/g, (_, p1, p2) => {
    return p1 + p2.toUpperCase()
  })
}

const setDotProp = (
  obj: { [k: string]: any },
  keys: string[],
  val: any
) => {
  let i = 0
  let length = keys.length
  let t = obj
  let x
  for (; i < length; ++i) {
    x = t[keys[i]]
    t = t[keys[i]] =
      i === length - 1
        ? val
        : x != null
        ? x
        : !!~keys[i + 1].indexOf('.') || !(+keys[i + 1] > -1)
        ? {}
        : []
  }
}

const getFileName = (input: string) => {
  const m = /([^\\\/]+)$/.exec(input)
  return m ? m[1] : ''
}

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  value != null
  && (typeof value === 'object' || typeof value === 'function')
  && 'then' in value
  && typeof value.then === 'function'

const camelcaseOptionName = (name: string) => {
  // Camelcase the option name
  // Don't camelcase anything after the dot `.`
  return name
    .split('.')
    .map((v, i) => {
      return i === 0 ? camelcase(v) : v
    })
    .join('.')
}

// ─── Option ───

class Option {
  /** Option name */
  name: string
  /** Option name and aliases */
  names: string[]
  isBoolean?: boolean
  // `required` will be a boolean for options with brackets
  required?: boolean
  /** Description text for help output */
  description: string
  /** Default value for this option */
  default?: unknown
  /** Standard JSON Schema V1 schema for type coercion and inference */
  schema?: StandardJSONSchemaV1
  /** Whether this option is deprecated (hidden from help output) */
  deprecated?: boolean

  /**
   * Create an option.
   * @param rawName - The raw option string, e.g. '--port <port>', '-v, --verbose'
   * @param descriptionOrSchema - Either a description string or a StandardJSONSchemaV1 schema.
   *   When a schema is provided, description and default are extracted from the JSON Schema.
   */
  constructor(
    public rawName: string,
    descriptionOrSchema?: string | StandardJSONSchemaV1,
  ) {
    if (typeof descriptionOrSchema === 'string') {
      this.description = descriptionOrSchema
    } else if (descriptionOrSchema && isStandardSchema(descriptionOrSchema)) {
      this.schema = descriptionOrSchema
      const meta = extractSchemaMetadata(descriptionOrSchema)
      this.description = meta.description ?? ''
      if (meta.default !== undefined) {
        this.default = meta.default
      }
      if (meta.deprecated) {
        this.deprecated = true
      }
    } else {
      this.description = ''
    }

    // You may use cli.option('--env.* [value]', 'desc') to denote a dot-nested option
    rawName = rawName.replace(/\.\*/g, '')

    this.names = removeBrackets(rawName)
      .split(',')
      .map((v: string) => {
        let name = v.trim().replace(/^-{1,2}/, '')
        return camelcaseOptionName(name)
      })
      .sort((a, b) => (a.length > b.length ? 1 : -1)) // Sort names

    // Use the longest name (last one) as actual option name
    this.name = this.names[this.names.length - 1]

    if (rawName.includes('<')) {
      this.required = true
    } else if (rawName.includes('[')) {
      this.required = false
    } else {
      // No arg needed, it's boolean flag
      this.isBoolean = true
    }
  }

  clone() {
    return new Option(this.rawName, this.schema ?? this.description)
  }
}

// ─── Command ───

// Type-level helpers for inferring option names and types

/**
 * Converts a kebab-case string to camelCase at the type level.
 * "--foo-bar <val>" → name "foo-bar" → camelCase "fooBar"
 */
type CamelCase<S extends string> =
  S extends `${infer L}-${infer R}`
    ? `${L}${CamelCase<Capitalize<R>>}`
    : S

/**
 * Extracts the long option name from a raw option string.
 * "-p, --port <port>"   → "port"
 * "--foo-bar <val>"     → "fooBar"
 * "--verbose"           → "verbose"
 */
type ExtractOptionName<S extends string> =
  // Match: --name <value> or --name [value] or --name
  S extends `${string}--${infer Name} <${string}>` ? CamelCase<Name> :
  S extends `${string}--${infer Name} [${string}]` ? CamelCase<Name> :
  S extends `${string}--${infer Name}` ? CamelCase<Name> :
  string

/**
 * Determines if an option takes a required value (<...>) vs optional ([...]) vs boolean flag.
 */
type IsOptionalOption<S extends string> =
  S extends `${string}<${string}>` ? false :
  true

/**
 * Infer the input type from a StandardTypedV1-compatible schema.
 *
 * For Zod, this is the type accepted by `.parse()` before any transforms or
 * defaults are applied (e.g. `z.number().default(30)` has input `number | undefined`).
 */
type InferSchemaInput<S> =
  S extends { readonly "~standard": { readonly types?: { readonly input: infer I } } } ? I : unknown

/**
 * Infer the output type from a StandardTypedV1-compatible schema.
 *
 * For Zod, this is the type produced by `.parse()` after transforms/defaults
 * run (e.g. `z.number().default(30)` has output `number`).
 */
type InferSchemaOutput<S> =
  S extends { readonly "~standard": { readonly types?: { readonly output: infer O } } } ? O : unknown

/**
 * Detects whether a Standard Schema has a "default" behavior: its input allows
 * `undefined` but its output does not. This matches `z.number().default(30)`
 * and similar `.default(...)` wrappers in other libraries: the schema fills
 * in a value whenever the caller omits it, so at runtime the property is
 * always populated and goke can mark it as required in the options type even
 * when the option is declared with `[value]` square brackets.
 *
 * The `unknown extends Input` guard excludes the `wrapJsonSchema` path, where
 * input defaults to `unknown` because the hand-written schema has no way to
 * express a separate input type. For those schemas we fall back to the raw
 * bracket-based optionality, which keeps existing behavior for consumers
 * that use `wrapJsonSchema<T>()` for truly optional options.
 */
type HasSchemaDefault<S> =
  unknown extends InferSchemaInput<S>
    ? false
    : undefined extends InferSchemaInput<S>
      ? undefined extends InferSchemaOutput<S>
        ? false
        : true
      : false

/**
 * Build the option type entry for a single .option() call.
 *
 * Required options (`<...>`) produce a required key.
 * Optional options (`[...]`) produce an optional key, EXCEPT when the schema
 * has an effective default (see `HasSchemaDefault`) — in that case goke's
 * runtime always surfaces the default value, so the property is typed as
 * required with the post-coercion output type.
 */
type OptionEntry<RawName extends string, Schema> =
  IsOptionalOption<RawName> extends true
    ? HasSchemaDefault<Schema> extends true
      ? { [K in ExtractOptionName<RawName>]: InferSchemaOutput<Schema> }
      : { [K in ExtractOptionName<RawName>]?: InferSchemaOutput<Schema> }
    : { [K in ExtractOptionName<RawName>]: InferSchemaOutput<Schema> }

/**
 * Infer the raw runtime value shape for an option declared without a schema.
 *
 * Required value options (`--port <port>`) always reach actions as strings.
 * Optional value options (`--host [host]`) reach actions as strings: the
 * empty string `''` when the flag is passed bare (`--host`), the given
 * value when passed with one (`--host example.com`), and `undefined` when
 * the flag is omitted entirely. This lets callers use a single `typeof`
 * check and, if they really care, distinguish "omitted" from "present but
 * empty" via `=== undefined` vs `=== ''`.
 * Plain flags (`--verbose`) are booleans.
 */
type UntypedOptionValue<RawName extends string> =
  RawName extends `${string}<${string}>` ? string :
  RawName extends `${string}[${string}]` ? string :
  boolean | undefined

/**
 * Build the option type entry for a `.option()` call that uses a plain
 * description (no schema).
 */
type UntypedOptionEntry<RawName extends string> =
  RawName extends `${string}<${string}>`
    ? { [K in ExtractOptionName<RawName>]: UntypedOptionValue<RawName> }
    : { [K in ExtractOptionName<RawName>]?: UntypedOptionValue<RawName> }

/**
 * Tokenize a command raw name by splitting on whitespace.
 * "mcp getNodeXml <id>" → ["mcp", "getNodeXml", "<id>"]
 * "" → []
 */
type TokenizeName<S extends string, Acc extends readonly string[] = []> =
  S extends `${infer Head} ${infer Rest}`
    ? TokenizeName<Rest, [...Acc, Head]>
    : S extends ''
      ? Acc
      : [...Acc, S]

/**
 * Given a single token, return the corresponding positional arg type or
 * `never` if the token is not a bracketed arg.
 *
 * `<id>`       → string          (required)
 * `[id]`       → string | undefined (optional)
 * `<...files>` → string[]        (variadic required)
 * `[...files]` → string[]        (variadic optional)
 * Anything else → never (filtered out by ExtractCommandArgs)
 */
type TokenToArgType<T extends string> =
  T extends `<...${string}>` ? string[] :
  T extends `[...${string}]` ? string[] :
  T extends `<${string}>` ? string :
  T extends `[${string}]` ? string | undefined :
  never

/**
 * Filter a tokenized command raw name down to the positional arg tokens
 * and map each to its inferred type.
 */
type ExtractCommandArgs<T extends readonly string[]> =
  T extends readonly [infer Head extends string, ...infer Tail extends string[]]
    ? [TokenToArgType<Head>] extends [never]
      ? ExtractCommandArgs<Tail>
      : [TokenToArgType<Head>, ...ExtractCommandArgs<Tail>]
    : []

/**
 * Extract the tuple of positional arg types from a command raw name.
 *
 * "mcp getNodeXml <id>"    → [string]
 * "convert <input> <output>" → [string, string]
 * "run [script]"           → [string | undefined]
 * "exec [...args]"         → [string[]]
 * "deploy"                 → []
 */
type ExtractPositionalArgs<RawName extends string> =
  ExtractCommandArgs<TokenizeName<RawName>>

/**
 * Everything after a literal `--` on the command line is collected into
 * `options['--']` as a string array (empty when `--` is absent). This key
 * is always present at runtime, so it's merged into every action's options
 * type regardless of which options the user declared.
 */
type DoubleDashOptions = { '--': string[] }

/**
 * Build the full argument tuple passed to a command's action callback.
 *
 * Format: [...positionalArgs, options, executionContext]
 *
 * This matches the runtime behavior in Goke.runMatchedCommand(): the action
 * is called with positional args from the parsed command, then the parsed
 * options object, then the injected GokeExecutionContext.
 *
 * The options type is always extended with `{ '--': string[] }` because the
 * parser always populates that key (see `Goke.parse()`).
 */
type ActionArgs<RawName extends string, Opts> =
  [
    ...ExtractPositionalArgs<RawName>,
    Opts & DoubleDashOptions,
    GokeExecutionContext,
  ]

interface CommandArg {
  required: boolean
  value: string
  variadic: boolean
}

interface HelpSection {
  title?: string
  body: string
}

interface CommandConfig {
  allowUnknownOptions?: boolean
  ignoreOptionDefaultValue?: boolean
}

type HelpCallback = (sections: HelpSection[]) => void | HelpSection[]

type CommandExample = ((bin: string) => string) | string

class Command<RawName extends string = string, Opts = {}> {
  options: Option[]
  aliasNames: string[]
  /* Parsed command name */
  name: string
  args: CommandArg[]
  commandAction?: (...args: any[]) => any
  usageText?: string
  versionNumber?: string
  examples: CommandExample[]
  helpCallback?: HelpCallback
  globalCommand?: GlobalCommand
  _hidden?: boolean

  constructor(
    public rawName: RawName,
    public description: string,
    public config: CommandConfig = {},
    public cli: Goke<any>
  ) {
    this.options = []
    this.aliasNames = []
    this.name = removeBrackets(rawName)
    this.args = findAllBrackets(rawName)
    this.examples = []
  }

  usage(text: string) {
    this.usageText = text
    return this
  }

  allowUnknownOptions() {
    this.config.allowUnknownOptions = true
    return this
  }

  ignoreOptionDefaultValue() {
    this.config.ignoreOptionDefaultValue = true
    return this
  }

  version(version: string, customFlags = '-v, --version') {
    this.versionNumber = version
    this.option(customFlags, 'Display version number')
    return this
  }

  example(example: CommandExample) {
    this.examples.push(example)
    return this
  }

  /**
   * Add an option for this command.
   *
   * The second argument is either a description string or a StandardJSONSchemaV1
   * schema. When a schema is provided, description and default are extracted from
   * the JSON Schema automatically, and the option's type is tracked on the
   * Command's `Opts` type parameter so that subsequent `.action()` callbacks
   * receive a fully-typed options object.
   *
   * @example
   * ```ts
   * // With Zod schema (description + default extracted from schema):
   * cmd.option('--port <port>', z.number().describe('Port number'))
   *
   * // Without schema (plain description, values are raw strings/booleans):
   * cmd.option('--verbose', 'Verbose output')
   * ```
   */
  option<
    OptionRawName extends string,
    S extends StandardJSONSchemaV1
  >(
    rawName: OptionRawName,
    schema: S,
  ): Command<RawName, Opts & OptionEntry<OptionRawName, S>>
  option<OptionRawName extends string>(
    rawName: OptionRawName,
    description?: string,
  ): Command<RawName, Opts & UntypedOptionEntry<OptionRawName>>
  option(rawName: string, descriptionOrSchema?: string | StandardJSONSchemaV1): any {
    const option = new Option(rawName, descriptionOrSchema)
    this.options.push(option)
    return this
  }

  alias(name: string) {
    this.aliasNames.push(name)
    return this
  }

  hidden() {
    this._hidden = true
    return this
  }

  /**
   * Register the action callback that runs when this command is matched.
   *
   * The callback receives positional args extracted from the command's raw name,
   * followed by the parsed options object and the injected GokeExecutionContext.
   *
   * Positional arg types are inferred from the raw name at the type level:
   *   `command('convert <input> <output>')` → `(input: string, output: string, options, ctx)`
   *   `command('run [script]')`              → `(script: string | undefined, options, ctx)`
   *   `command('exec [...args]')`            → `(args: string[], options, ctx)`
   *
   * The options object is typed according to every `.option()` call chained
   * on this command, plus any global options declared on the parent Goke
   * instance before `.command()` was called.
   */
  action(
    callback: (...args: ActionArgs<RawName, Opts>) => unknown | Promise<unknown>,
  ): this {
    // Give anonymous functions a name derived from the command so stack traces
    // show e.g. "command:deploy" instead of "<anonymous>"
    if (!callback.name) {
      const label = this.name ? `command:${this.name}` : 'command:default'
      Object.defineProperty(callback, 'name', { value: label })
    }
    this.commandAction = callback
    return this
  }

  /**
   * Return the registered action callback with full type safety.
   *
   * Use this in tests to call the action directly without parsing argv.
   * The returned function has the same typed signature as the `.action()` callback:
   * `(..positionalArgs, options, executionContext) => unknown | Promise<unknown>`
   *
   * Throws if no action has been registered on this command.
   *
   * @example
   * ```ts
   * const cmd = cli
   *   .command('deploy', 'Deploy')
   *   .option('--env <env>', z.enum(['staging', 'production']))
   *   .action((options, { console }) => console.log(options.env))
   *
   * const action = cmd.getAction()
   * action({ env: 'staging', '--': [] }, cli.createExecutionContext({ stdout }))
   * ```
   */
  getAction(): (...args: ActionArgs<RawName, Opts>) => unknown | Promise<unknown> {
    if (!this.commandAction) {
      throw new GokeError(`No action registered on command "${this.name || '(default)'}"`)
    }
    return this.commandAction
  }

  isMatched(args: string[]): { matched: boolean; consumedArgs: number } {
    const nameParts = this.name.split(' ').filter(Boolean)

    if (nameParts.length === 0) {
      return { matched: false, consumedArgs: 0 }
    }

    if (args.length < nameParts.length) {
      return { matched: false, consumedArgs: 0 }
    }

    for (let i = 0; i < nameParts.length; i++) {
      if (nameParts[i] !== args[i]) {
        if (i === 0 && this.aliasNames.includes(args[i])) {
          continue
        }
        return { matched: false, consumedArgs: 0 }
      }
    }

    return { matched: true, consumedArgs: nameParts.length }
  }

  get isDefaultCommand() {
    return this.name === '' || this.aliasNames.includes('!')
  }

  get isGlobalCommand(): boolean {
    return this instanceof GlobalCommand
  }

  /**
   * Check if an option is registered in this command
   * @param name Option name
   */
  hasOption(name: string) {
    name = name.split('.')[0]
    return this.options.find((option) => {
      return option.names.includes(name)
    })
  }

  /**
   * Return the formatted help string without printing it.
   * Useful for embedding help text in documentation, tests, or other programmatic uses.
   */
  helpText(): string {
    const { name, commands } = this.cli
    const {
      versionNumber,
      options: globalOptions,
      helpCallback,
    } = this.cli.globalCommand

    let sections: HelpSection[] = [
      {
        body: pc.bold(pc.cyan(`${name}${versionNumber ? `/${versionNumber}` : ''}`)),
      },
    ]

    sections.push({
      title: 'Usage',
      body: `  ${pc.green('$')} ${pc.bold(name)} ${this.usageText || this.rawName || '[options]'}`,
    })

    const showCommands =
      (this.isGlobalCommand || this.isDefaultCommand) && commands.length > 0
    const terminalWidth = Math.max(this.cli.columns, 40)

    if (showCommands) {
      const commandRows = commands.filter((command) => !command._hidden).map((command) => {
        const displayName = command.rawName.trim() === '' ? name : command.rawName
        // Hide deprecated options from subcommand help output
        const displayOptions = command.isDefaultCommand ? [] : command.options.filter((o) => !o.deprecated)
        return {
          command,
          displayName,
          displayOptions,
        }
      })

      const longestCommandNameLength = maxVisibleLength(
        commandRows.map((row) => row.displayName)
      )
      const longestCommandOptions = commandRows
        .flatMap((row) => row.displayOptions.map((option) => option.rawName))
      const longestCommandOptionNameLength = maxVisibleLength(longestCommandOptions)
      const commandDescriptionColumn = 2 + longestCommandNameLength + 2
      const optionDescriptionColumn = 4 + longestCommandOptionNameLength + 2
      const sharedDescriptionColumn = Math.max(commandDescriptionColumn, optionDescriptionColumn)
      const descriptionWidth = terminalWidth - sharedDescriptionColumn

      sections.push({
        title: 'Commands',
          body: commandRows
          .map(({ command, displayName, displayOptions }) => {
            const commandDescription = formatWrappedDescription(
              command.description,
              descriptionWidth,
              sharedDescriptionColumn,
            )
            const commandPrefix = `  ${pc.bold(commandGreen(displayName))}`
            const commandPadding = ' '.repeat(
              Math.max(2, sharedDescriptionColumn - (2 + visibleLength(displayName)))
            )
            const headerLine = commandDescription
              ? `${commandPrefix}${commandPadding}${commandDescription}`
              : commandPrefix

            if (displayOptions.length === 0) {
              return headerLine
            }

            const optionLines = displayOptions
              .map((option) => {
                const optionDescription = formatWrappedDescription(
                  optionDescriptionText(option),
                  descriptionWidth,
                  sharedDescriptionColumn,
                )
                const optionPrefix = `    ${optionBlue(option.rawName)}`
                const optionPadding = ' '.repeat(
                  Math.max(2, sharedDescriptionColumn - (4 + visibleLength(option.rawName)))
                )
                return optionDescription
                  ? `${optionPrefix}${optionPadding}${optionDescription}`
                  : optionPrefix
              })
              .join('\n')

            return `${headerLine}\n\n${optionLines}`
          })
          .join('\n\n\n'),
      })
    }

    const defaultCommandOptions = this.isGlobalCommand
      ? commands
        .filter((command) => command.isDefaultCommand)
        .flatMap((command) => command.options)
      : []

    const mergedGlobalAndDefaultOptions = [...globalOptions]
    const mergedOptionNames = new Set(globalOptions.map((option) => option.name))
    for (const option of defaultCommandOptions) {
      if (!mergedOptionNames.has(option.name)) {
        mergedGlobalAndDefaultOptions.push(option)
        mergedOptionNames.add(option.name)
      }
    }

    const mergedCommandAndGlobalOptions = [...this.options]
    const mergedCommandOptionNames = new Set(this.options.map((option) => option.name))
    for (const option of globalOptions || []) {
      if (!mergedCommandOptionNames.has(option.name)) {
        mergedCommandAndGlobalOptions.push(option)
        mergedCommandOptionNames.add(option.name)
      }
    }

    let options = this.isGlobalCommand
      ? mergedGlobalAndDefaultOptions
      : mergedCommandAndGlobalOptions
    if (!this.isGlobalCommand && !this.isDefaultCommand) {
      options = options.filter((option) => option.name !== 'version')
    }
    // Hide deprecated options from help output
    options = options.filter((option) => !option.deprecated)
    if (options.length > 0) {
      const longestOptionNameLength = maxVisibleLength(
        options.map((option) => option.rawName)
      )
      const descriptionColumn = 2 + longestOptionNameLength + 2
      const descriptionWidth = terminalWidth - descriptionColumn
      sections.push({
        title: 'Options',
        body: options
          .map((option) => {
            const optionLabel = padRight(option.rawName, longestOptionNameLength)
            const description = formatWrappedDescription(
              optionDescriptionText(option),
              descriptionWidth,
              descriptionColumn,
            )
            return description
              ? `  ${optionBlue(optionLabel)}  ${description}`
              : `  ${optionBlue(optionLabel)}`
          })
          .join('\n'),
      })
    }

    // Show full description for specific commands (not global/default)
    if (!this.isGlobalCommand && !this.isDefaultCommand && this.description) {
      const descriptionLines = wrapDescription(this.description, terminalWidth - 2)
      sections.push({
        title: 'Description',
        body: descriptionLines
          .map((line) => (line ? `  ${pc.dim(line)}` : ''))
          .join('\n'),
      })
    }

    if (this.examples.length > 0) {
      sections.push({
        title: 'Examples',
        body: this.examples
          .map((example) => {
            if (typeof example === 'function') {
              return example(name)
            }
            return example
          })
          .join('\n'),
      })
    }

    if (helpCallback) {
      sections = helpCallback(sections) || sections
    }

    return sections
      .map((section) => {
        return section.title
          ? `${pc.bold(pc.blue(section.title))}:\n${section.body}`
          : section.body
      })
      .join('\n\n\n')
  }

  outputHelp() {
    this.cli.console.log(this.helpText())
  }

  outputVersion() {
    const { name } = this.cli
    const { versionNumber } = this.cli.globalCommand
    if (versionNumber) {
      this.cli.console.log(`${name}/${versionNumber} ${platformInfo}`)
    }
  }

  checkRequiredArgs() {
    const minimalArgsCount = this.args.filter((arg) => arg.required).length

    if (this.cli.args.length < minimalArgsCount) {
      throw new GokeError(
        `missing required args for command \`${this.rawName}\``
      )
    }
  }

  /**
   * Check if the parsed options contain any unknown options
   *
   * Exit and output error when true
   */
  checkUnknownOptions() {
    const { options, globalCommand } = this.cli

    if (!this.config.allowUnknownOptions) {
      for (const name of Object.keys(options)) {
        if (
          name !== '--' &&
          !this.hasOption(name) &&
          !globalCommand.hasOption(name)
        ) {
          throw new GokeError(
            `Unknown option \`${name.length > 1 ? `--${name}` : `-${name}`}\``
          )
        }
      }
    }
  }

  /**
   * Check if the required string-type options exist
   */
  checkOptionValue() {
    const { options: parsedOptions, globalCommand } = this.cli
    const options = [...globalCommand.options, ...this.options]
    for (const option of options) {
      // Resolve the full dot-path to get the actual value.
      // For "config.port", traverse parsedOptions.config.port instead of just parsedOptions.config.
      const keys = option.name.split('.')
      let value: unknown = parsedOptions
      for (const key of keys) {
        if (value != null && typeof value === 'object') {
          value = (value as Record<string, unknown>)[key]
        } else {
          value = undefined
          break
        }
      }
      // Check required option value
      if (option.required) {
        if (value === true || value === false) {
          throw new GokeError(`option \`${option.rawName}\` value is missing`)
        }
      }
    }
  }
}

class GlobalCommand extends Command {
  constructor(cli: Goke<any>) {
    super('@@global@@', '', {}, cli)
  }
}

const cloneCommandInto = (source: Command, cli: Goke<any>) => {
  const target = source instanceof GlobalCommand
    ? new GlobalCommand(cli)
    : new Command(source.rawName, source.description, { ...source.config }, cli)

  target.aliasNames = [...source.aliasNames]
  target.usageText = source.usageText
  target.versionNumber = source.versionNumber
  target.examples = [...source.examples]
  target.helpCallback = source.helpCallback
  target.commandAction = source.commandAction
  target._hidden = source._hidden
  target.options = source.options.map((option) => option.clone())
  target.globalCommand = cli.globalCommand

  return target
}

// ─── I/O interfaces ───

/**
 * Output stream interface, modeled after Node's process.stdout / process.stderr.
 * Requires only a `write` method that accepts a string.
 */
interface GokeOutputStream {
  write(data: string): void
}

/**
 * Console-like object returned by `createConsole`.
 * Provides `log` and `error` methods that route output through
 * the configured GokeOutputStream instances.
 */
interface GokeConsole {
  log(...args: unknown[]): void
  error(...args: unknown[]): void
  warn(...args: unknown[]): void
  info(...args: unknown[]): void
}

interface GokeProcess {
  argv: string[]
  cwd: string
  env: Record<string, string | undefined>
  stdin: string
  stdout: GokeOutputStream
  stderr: GokeOutputStream
  exit(code: number): never | void
}

interface GokeExecutionContext {
  console: GokeConsole
  fs: GokeFs
  process: GokeProcess
}

/**
 * Per-request overrides accepted by `Goke#createExecutionContext()`.
 *
 * Any field left `undefined` falls back to the `Goke` instance's
 * defaults (set via `GokeOptions`), which themselves fall back to the
 * real Node.js `process.*`. Use this to construct an execution context
 * with tenant-specific values — e.g. a per-user `cwd`/`env`/`fs` pair
 * for a remote MCP server, or capture streams for stdout/stderr.
 *
 * Passing a custom `exit` replaces the default behavior of calling
 * `this.exit(code)`. The returned `process.exit` still throws
 * `GokeProcessExit` after the user-provided `exit` returns, so callers
 * can catch the exit without the outer code needing to know about it.
 */
interface GokeExecutionContextOverride {
  /** Override the argv array exposed as `process.argv`. Defaults to the cli's raw parsed argv. */
  argv?: string[]
  /** Override the working directory exposed as `process.cwd`. */
  cwd?: string
  /** Override the environment exposed as `process.env`. */
  env?: Record<string, string | undefined>
  /** Override the filesystem exposed as `ctx.fs`. */
  fs?: GokeFs
  /** Override the stdin content exposed as `process.stdin`. */
  stdin?: string
  /** Override the stdout stream used by `ctx.console.log` and exposed as `process.stdout`. */
  stdout?: GokeOutputStream
  /** Override the stderr stream used by `ctx.console.error` and exposed as `process.stderr`. */
  stderr?: GokeOutputStream
  /**
   * Override the exit function called by `process.exit(code)`.
   *
   * The returned context still throws `GokeProcessExit` after this
   * callback returns, so callers that want to capture the exit
   * without killing the host process can pass `() => {}`.
   */
  exit?: (code: number) => void
}

class GokeProcessExit extends Error {
  code: number

  constructor(code: number) {
    super(`process.exit(${code})`)
    this.name = 'GokeProcessExit'
    this.code = code
  }
}

/**
 * Options for configuring a Goke CLI instance.
 */
interface GokeOptions {
  /** Custom cwd value exposed through the injected process context. */
  cwd?: string
  /** Custom environment exposed through the injected process context. */
  env?: Record<string, string | undefined>
  /** Custom fs implementation. Defaults to node:fs/promises in Node runtimes. */
  fs?: GokeFs
  /** Custom stdin content exposed through the injected process context. */
  stdin?: string
  /** Custom stdout stream. Defaults to process.stdout */
  stdout?: GokeOutputStream
  /** Custom stderr stream. Defaults to process.stderr */
  stderr?: GokeOutputStream
  /** Custom argv array. Defaults to process.argv */
  argv?: string[]
  /** Terminal width used to wrap help output. Defaults to process.stdout.columns, or Infinity when unavailable */
  columns?: number
  /**
   * Custom exit function called on CLI errors (unknown option, missing value, etc.).
   * Defaults to process.exit. Set to a no-op or throw to prevent exit in tests.
   */
  exit?: (code: number) => void
}

/**
 * Creates a console-like object that writes to the given output streams.
 *
 * Joins arguments with a space and appends a newline, then writes to the
 * provided stream. Does not support format specifiers like `%d` — only
 * simple string concatenation via `String()` conversion.
 */
function createConsole(stdout: GokeOutputStream, stderr: GokeOutputStream): GokeConsole {
  return {
    log(...args: unknown[]) {
      stdout.write(args.map(String).join(' ') + '\n')
    },
    error(...args: unknown[]) {
      stderr.write(args.map(String).join(' ') + '\n')
    },
    warn(...args: unknown[]) {
      stderr.write(args.map(String).join(' ') + '\n')
    },
    info(...args: unknown[]) {
      stdout.write(args.map(String).join(' ') + '\n')
    },
  }
}

// ─── Error formatting ───

/**
 * Format an error for CLI output.
 * Prints a red "error:" prefix with the message, followed by a dimmed stack trace.
 */
function formatCliError(err: Error): string {
  const lines: string[] = []
  lines.push(`${pc.red(pc.bold('error:'))} ${err.message}`)
  if (err.stack) {
    // Extract just the stack frames (skip the first line which is the message)
    const stackLines = err.stack.split('\n').slice(1)
    if (stackLines.length > 0) {
      lines.push('')
      lines.push(pc.red(pc.dim(stackLines.join('\n'))))
    }
  }
  return lines.join('\n')
}

// ─── Goke (main CLI class) ───

interface ParsedArgv {
  args: ReadonlyArray<string>
  options: {
    [k: string]: any
  }
}

class Goke<Opts = {}> extends EventEmitter {
  /** The program name to display in help and version message */
  name: string
  commands: Command<any, any>[]
  /** Middleware functions that run before the matched command action, in registration order */
  middlewares: Array<{ action: (options: any, context: GokeExecutionContext) => void | Promise<void> }>
  globalCommand: GlobalCommand
  matchedCommand?: Command<any, any>
  matchedCommandName?: string
  /**
   * Raw CLI arguments
   */
  rawArgs: string[]
  /**
   * Parsed CLI arguments
   */
  args: ParsedArgv['args']
  /**
   * Parsed CLI options, camelCased
   */
  options: ParsedArgv['options']

  showHelpOnExit?: boolean
  showVersionOnExit?: boolean

  /** Working directory exposed through the injected process context. */
  readonly cwd?: string
  /** Environment exposed through the injected process context. */
  readonly env?: Record<string, string | undefined>
  /** Output stream for normal output (help, version, etc.) */
  readonly fs: GokeFs
  /** Standard input exposed through the injected process context. */
  readonly stdin?: string
  /** Output stream for normal output (help, version, etc.) */
  readonly stdout: GokeOutputStream
  /** Output stream for error output */
  readonly stderr: GokeOutputStream
  /** Console-like object that routes through stdout/stderr */
  readonly console: GokeConsole
  /** Terminal width used to wrap help output text */
  readonly columns: number
  /** Exit function called on CLI errors. Defaults to process.exit */
  readonly exit: (code: number) => void

  #defaultArgv: string[]

  /**
   * @param name The program name to display in help and version message
   * @param options Configuration for stdout, stderr, and argv
   */
  constructor(name = '', options?: GokeOptions) {
    super()
    this.name = name
    this.commands = []
    this.middlewares = []
    this.rawArgs = []
    this.args = []
    this.options = {}
    this.cwd = options?.cwd
    this.env = options?.env
    this.fs = options?.fs ?? runtimeFs
    this.stdin = options?.stdin
    this.stdout = options?.stdout ?? process.stdout
    this.stderr = options?.stderr ?? process.stderr
    this.console = createConsole(this.stdout, this.stderr)
    this.columns = options?.columns ?? process.stdout.columns ?? Number.POSITIVE_INFINITY
    this.exit = options?.exit ?? ((code: number) => process.exit(code))
    this.#defaultArgv = options?.argv ?? processArgs
    this.globalCommand = new GlobalCommand(this)
    this.globalCommand.usage('<command> [options]')
  }

  clone(options?: GokeOptions) {
    const cloned = new Goke<Opts>(this.name, {
      cwd: options?.cwd ?? this.cwd,
      env: options?.env ?? this.env,
      fs: options?.fs ?? this.fs,
      stdin: options?.stdin ?? this.stdin,
      stdout: options?.stdout ?? this.stdout,
      stderr: options?.stderr ?? this.stderr,
      argv: options?.argv ?? this.#defaultArgv,
      columns: options?.columns ?? this.columns,
      exit: options?.exit ?? this.exit,
    })

    cloned.showHelpOnExit = this.showHelpOnExit
    cloned.showVersionOnExit = this.showVersionOnExit
    cloned.globalCommand = cloneCommandInto(this.globalCommand, cloned) as GlobalCommand
    cloned.commands = this.commands.map((command) => cloneCommandInto(command, cloned))
    for (const command of cloned.commands) {
      command.globalCommand = cloned.globalCommand
    }
    cloned.middlewares = this.middlewares.map((middleware) => ({ action: middleware.action }))

    for (const eventName of this.eventNames()) {
      for (const listener of this.listeners(eventName)) {
        cloned.on(eventName, listener)
      }
    }

    return cloned
  }

  /**
   * Build a `GokeExecutionContext` using this cli's defaults, optionally
   * overridden per-request.
   *
   * `runMatchedCommand()` calls this internally with no arguments to
   * construct the context passed to command actions and middlewares.
   *
   * The method is also public so adapters (MCP, remote RPC, batch
   * runners, etc.) can build a context for a single invocation with
   * tenant-specific values — e.g. capture streams for stdout/stderr,
   * a per-user `cwd`/`env`/`fs`, or an `exit` that throws instead of
   * killing the host process. See {@link GokeExecutionContextOverride}.
   *
   * @example
   * ```ts
   * // Build an execution context that captures output into strings and
   * // treats `ctx.process.exit(code)` as a `GokeProcessExit` throw
   * // instead of terminating the host process.
   * const stdout = createTextCaptureStream()
   * const stderr = createTextCaptureStream()
   * const ctx = cli.createExecutionContext({
   *   stdout,
   *   stderr,
   *   exit: () => {},
   * })
   * try {
   *   await action(...args, options, ctx)
   * } catch (err) {
   *   if (err instanceof GokeProcessExit) {
   *     // handle exit code
   *   } else {
   *     throw err
   *   }
   * }
   * ```
   */
  createExecutionContext(override?: GokeExecutionContextOverride): GokeExecutionContext {
    const stdout = override?.stdout ?? this.stdout
    const stderr = override?.stderr ?? this.stderr
    // Reuse the cached console when streams aren't overridden; otherwise
    // build a new one so ctx.console.log writes to the overridden streams.
    const contextConsole = (override?.stdout !== undefined || override?.stderr !== undefined)
      ? createConsole(stdout, stderr)
      : this.console
    const exitFn = override?.exit ?? this.exit
    return {
      console: contextConsole,
      fs: override?.fs ?? this.fs,
      process: {
        argv: override?.argv ?? this.rawArgs,
        cwd: override?.cwd ?? this.cwd ?? process.cwd(),
        env: override?.env ?? this.env ?? process.env,
        stdin: override?.stdin ?? this.stdin ?? '',
        stdout,
        stderr,
        exit: (code) => {
          exitFn(code)
          throw new GokeProcessExit(code)
        },
      },
    }
  }

  async createJustBashCommand(options?: { name?: string }) {
    return createJustBashCommandBridge(this, options)
  }

  /**
   * Add a global usage text.
   *
   * This is not used by sub-commands.
   */
  usage(text: string) {
    this.globalCommand.usage(text)
    return this
  }

  /**
   * Add a sub-command.
   *
   * The returned Command is parameterized by the literal `rawName` (so positional
   * args can be inferred at the type level) and by this Goke's accumulated global
   * `Opts` (so global options declared before `.command()` are visible inside
   * `.action()` callbacks alongside the command's own options).
   */
  command<CommandRawName extends string>(
    rawName: CommandRawName,
    description?: string,
    config?: CommandConfig,
  ): Command<CommandRawName, Opts> {
    const command = new Command<CommandRawName, Opts>(
      rawName,
      description || '',
      config,
      this,
    )
    command.globalCommand = this.globalCommand
    this.commands.push(command)
    return command
  }

  /**
   * Add a global CLI option.
   *
   * Which is also applied to sub-commands.
   *
   * When a StandardJSONSchemaV1 schema is provided, the return type is narrowed
   * to include the inferred option type — enabling type-safe `.use()` callbacks
   * and typed `options` params inside command `.action()` handlers.
   *
   * When a plain description string is provided, the option is still tracked on
   * the Goke's `Opts` type, but with a loose `string | boolean | undefined` value
   * type (since no coercion schema is available).
   */
  option<
    RawName extends string,
    S extends StandardJSONSchemaV1
  >(rawName: RawName, schema: S): Goke<Opts & OptionEntry<RawName, S>>
  option<RawName extends string>(
    rawName: RawName,
    description?: string,
  ): Goke<Opts & UntypedOptionEntry<RawName>>
  option(rawName: string, descriptionOrSchema?: string | StandardJSONSchemaV1): any {
    const option = new Option(rawName, descriptionOrSchema)
    this.globalCommand.options.push(option)
    return this
  }

  /**
   * Register a middleware function that runs before the matched command action.
   *
   * Middleware runs in registration order, after option parsing and validation,
   * but before the command's `.action()` callback. Useful for reacting to global
   * options (e.g. setting up logging, initializing state).
   *
   * The callback receives the parsed options object, typed according to all
   * `.option()` calls that precede this `.use()` in the chain, plus an injected
   * execution context with `{ console, process }` for portable output and exits.
   *
   * @example
   * ```ts
   * cli
   *   .option('--verbose', z.boolean().default(false).describe('Verbose'))
   *   .use((options, { console }) => {
   *     if (options.verbose) {
   *       console.log('verbose mode enabled')
   *     }
   *   })
   * ```
   *
   * Alternatively, pass another `Goke` instance to compose commands from
   * separate files. All commands defined on the sub-CLI are merged into
   * this CLI. Middlewares and global options from the sub-CLI are NOT
   * copied; only commands are composed.
   *
   * @example
   * ```ts
   * // selfhost.ts
   * export const selfhostCli = goke()
   * selfhostCli
   *   .command('selfhost', 'Set up on your own workspace')
   *   .option('-t, --token [token]', 'Admin token')
   *   .action((options) => { ... })
   *
   * // main.ts
   * import { selfhostCli } from './selfhost.js'
   * goke('mycli')
   *   .use(selfhostCli)
   *   .help()
   *   .parse(process.argv)
   * ```
   */
  use(subCli: Goke<any>): this
  use(
    callback: (
      options: Opts & DoubleDashOptions,
      context: GokeExecutionContext,
    ) => void | Promise<void>,
  ): this
  use(
    callbackOrCli:
      | Goke<any>
      | ((options: Opts & DoubleDashOptions, context: GokeExecutionContext) => void | Promise<void>),
  ): this {
    if (callbackOrCli instanceof Goke) {
      for (const command of callbackOrCli.commands) {
        this.commands.push(cloneCommandInto(command, this))
      }
      return this
    }
    this.middlewares.push({ action: callbackOrCli })
    return this
  }

  /**
   * Show help message when `-h, --help` flags appear.
   *
   */
  help(callback?: HelpCallback) {
    this.globalCommand.option('-h, --help', 'Display this message')
    this.globalCommand.helpCallback = callback
    this.showHelpOnExit = true
    return this
  }

  /**
   * Show version number when `-v, --version` flags appear.
   *
   */
  version(version: string, customFlags = '-v, --version') {
    this.globalCommand.version(version, customFlags)
    this.showVersionOnExit = true
    return this
  }

  /**
   * Add a global example.
   *
   * This example added here will not be used by sub-commands.
   */
  example(example: CommandExample) {
    this.globalCommand.example(example)
    return this
  }

  /**
   * Return the formatted help string without printing it.
   * When a sub-command is matched, returns help for that command.
   * Otherwise returns the global help.
   */
  helpText(): string {
    if (this.matchedCommand) {
      return this.matchedCommand.helpText()
    }
    return this.globalCommand.helpText()
  }

  /**
   * Output the corresponding help message
   * When a sub-command is matched, output the help message for the command
   * Otherwise output the global one.
   */
  outputHelp() {
    this.console.log(this.helpText())
  }

  /**
   * Output help for commands matching a prefix.
   * Used when user types "mcp nonexistent" and we have "mcp login", "mcp status", etc.
   */
  outputHelpForPrefix(prefix: string, matchingCommands: Command[], fromHelpFlag = false) {
    const { versionNumber } = this.globalCommand

    this.console.log(`${this.name}${versionNumber ? `/${versionNumber}` : ''}`)
    this.console.log()
    if (!fromHelpFlag) {
      this.console.log(
        `Unknown command: ${this.args.join(' ')}`
      )
      this.console.log()
    }
    this.console.log(`Available "${prefix}" commands:`)
    this.console.log()

    const longestName = Math.max(...matchingCommands.map((c) => c.rawName.length))
    for (const cmd of matchingCommands) {
      const firstLine = cmd.description.split('\n')[0].trim()
      this.console.log(`  ${cmd.rawName.padEnd(longestName)}  ${firstLine}`)
    }

    this.console.log()
    this.console.log(`Run "${this.name} <command> --help" for more information.`)
  }

  /**
   * Output the version number.
   *
   */
  outputVersion() {
    this.globalCommand.outputVersion()
  }

  private setParsedInfo(
    { args, options }: ParsedArgv,
    matchedCommand?: Command,
    matchedCommandName?: string
  ) {
    this.args = args
    this.options = options
    if (matchedCommand) {
      this.matchedCommand = matchedCommand
    }
    if (matchedCommandName) {
      this.matchedCommandName = matchedCommandName
    }
    return this
  }

  unsetMatchedCommand() {
    this.matchedCommand = undefined
    this.matchedCommandName = undefined
  }

  /**
   * Handle a CLI error by formatting it and writing to stderr.
   * For GokeError / coercion errors, also includes a help hint.
   */
  private handleCliError(err: Error): void {
    this.console.error(formatCliError(err))

    // Add help hint when help is enabled
    if (this.showHelpOnExit) {
      const cmdName = this.matchedCommandName
        ? `${this.name} ${this.matchedCommandName} --help`
        : `${this.name} --help`
      this.console.error(`\nRun "${cmdName}" for usage information.`)
    }
  }

  /**
   * Register shell completion commands: `completions install` and `completions uninstall`.
   *
   * Also wires the hidden `--get-goke-completions` flag that shell scripts call
   * on each Tab press. When this flag is detected during `parse()`, the CLI
   * prints matching completions to stdout and exits immediately.
   *
   * @example
   * ```ts
   * goke('mycli')
   *   .help()
   *   .completions()
   *   .command('deploy', 'Deploy the app')
   *   .parse(process.argv)
   *
   * // Then the user runs:
   * //   mycli completions install
   * //   mycli dep<TAB>  →  mycli deploy
   * ```
   */
  completions() {
    this.command('completions install', 'Install shell completions')
      .option('--shell [shell]', 'Target shell (zsh or bash). Auto-detected if omitted.')
      .action(async (options, { console, process: proc }) => {
        const shell = validateShell(options.shell)
        const cliPath = proc.argv[1] ?? this.name
        const result = await installCompletions(this.name, cliPath, shell)
        console.log(`Wrote ${result.shell} completions to ${result.path}`)
        if (result.shell === 'zsh') {
          console.log('Restart your shell or run: autoload -Uz compinit && compinit')
        } else {
          console.log('Restart your shell to enable completions.')
        }
      })

    this.command('completions uninstall', 'Remove shell completions')
      .option('--shell [shell]', 'Target shell (zsh or bash). Auto-detected if omitted.')
      .action(async (options, { console }) => {
        const shell = validateShell(options.shell)
        const removed = await uninstallCompletions(this.name, shell)
        if (removed.length > 0) {
          for (const p of removed) {
            console.log(`Removed ${p}`)
          }
        } else {
          console.log('No completion files found to remove.')
        }
      })

    this.command('completions script', 'Print the completion script to stdout')
      .option('--shell [shell]', 'Target shell (zsh or bash). Auto-detected if omitted.')
      .action((options, { console, process: proc }) => {
        const shell = validateShell(options.shell) ?? detectShell()
        if (!shell) {
          throw new GokeError(
            'Could not detect shell. Set the SHELL environment variable or pass --shell explicitly.',
          )
        }
        const cliPath = proc.argv[1] ?? this.name
        const script = generateCompletionScript(shell, this.name, cliPath)
        console.log(script)
      })

    return this
  }

  /**
   * Compute completions for the given args (as received from the shell script).
   *
   * Returns an array of completion strings. For zsh, each entry is `name:description`.
   * For bash, each entry is just the name.
   *
   * @internal Used by parse() when --get-goke-completions is detected.
   */
  getCompletions(argv: string[]): string[] {
    // argv comes from the shell: ["my-cli", "dep", ""] or ["my-cli", "deploy", "--"]
    // Strip the binary name (first element, which is the CLI name itself)
    const args = argv.slice(1)
    const current = args.length > 0 ? args[args.length - 1] : ''
    const previous = args.slice(0, -1)

    // Use GOKE_COMPLETION_SHELL (set by the shell shim) over $SHELL to avoid
    // format mismatch when e.g. a bash shim runs on a machine where $SHELL is zsh.
    const isZsh = detectCompletionShell() === 'zsh'

    const completions: string[] = []
    const escapeColon = (s: string) => s.replace(/:/g, '\\:')

    // Extract the long --flag from an option's rawName string.
    // rawName is like "--dry-run", "-v, --verbose", "--port <port>"
    // Returns the original kebab-case flag including dashes.
    const getLongFlag = (option: Option): string => {
      const parts = removeBrackets(option.rawName).split(',').map((s) => s.trim())
      // Prefer the -- prefixed part; fall back to the last part (short-only flags like -x)
      const longPart = parts.find((p) => p.startsWith('--')) ?? parts[parts.length - 1]
      return longPart.startsWith('-') ? longPart : `--${longPart}`
    }

    // Check if the previous token is a non-boolean option expecting a value.
    // In that case we should NOT suggest more flags or commands; let the shell
    // fall back to file completion or return nothing.
    const isAwaitingOptionValue = (): boolean => {
      if (previous.length === 0) return false
      const lastToken = previous[previous.length - 1]
      if (!lastToken.startsWith('-')) return false

      // Find the option matching this token across all registered options
      const allOptions = [
        ...this.globalCommand.options,
        ...this.commands.flatMap((c) => c.options),
      ]
      const tokenName = camelcaseOptionName(lastToken.replace(/^-{1,2}/, ''))
      for (const option of allOptions) {
        if (option.names.includes(tokenName)) {
          // If it takes a value (required or optional) and is not boolean, we're awaiting a value
          return !option.isBoolean && option.required !== undefined
        }
      }
      return false
    }

    // If the previous token is a non-boolean option, don't suggest anything.
    // Let the shell fall back to file completion.
    if (!current.startsWith('-') && isAwaitingOptionValue()) {
      return []
    }

    // Helper to push an option as a completion entry
    const pushOption = (option: Option) => {
      const flag = getLongFlag(option)
      if (isZsh && option.description) {
        completions.push(`${escapeColon(flag)}:${escapeColon(option.description)}`)
      } else {
        completions.push(flag)
      }
    }

    // Check if any alias of an option has already been used
    const isOptionUsed = (option: Option, usedOptions: Set<string>): boolean => {
      return option.names.some((name) => usedOptions.has(name))
    }

    // Try to match a command from the previous words
    let matchedCommand: Command | undefined
    let consumedArgs = 0

    // Sort by name length (longest first) for greedy matching
    const sortedCommands = [...this.commands].sort((a, b) => {
      const aLen = a.name.split(' ').filter(Boolean).length
      const bLen = b.name.split(' ').filter(Boolean).length
      return bLen - aLen
    })

    for (const command of sortedCommands) {
      const result = command.isMatched(previous as string[])
      if (result.matched) {
        matchedCommand = command
        consumedArgs = result.consumedArgs
        break
      }
    }

    if (matchedCommand) {
      // We matched a command, suggest its options
      const usedOptions = new Set(
        previous.slice(consumedArgs)
          .filter((a) => a.startsWith('-'))
          .map((a) => a.replace(/^-{1,2}/, ''))
          .map(camelcaseOptionName),
      )

      const allOptions = [...(matchedCommand.globalCommand?.options ?? []), ...matchedCommand.options]

      for (const option of allOptions) {
        if (option.deprecated) continue
        // Skip already-used options (check all aliases, not just the primary name)
        if (option.isBoolean && isOptionUsed(option, usedOptions)) continue

        const flag = getLongFlag(option)

        if (current.startsWith('-')) {
          if (!flag.startsWith(current)) continue
        } else if (current !== '') {
          continue
        }

        pushOption(option)
      }

      // If current word doesn't start with -, also suggest subcommands that extend this one
      if (!current.startsWith('-')) {
        const prefix = matchedCommand.name ? matchedCommand.name + ' ' : ''
        for (const cmd of this.commands) {
          if (cmd._hidden) continue
          if (cmd === matchedCommand) continue
          if (cmd.name.startsWith(prefix) && cmd.name !== matchedCommand.name) {
            const sub = cmd.name.slice(prefix.length).split(' ')[0]
            if (sub.startsWith(current)) {
              if (isZsh) {
                const desc = cmd.description.split('\n')[0].trim()
                completions.push(desc ? `${escapeColon(sub)}:${escapeColon(desc)}` : sub)
              } else {
                completions.push(sub)
              }
            }
          }
        }
      }
    } else {
      // No command matched yet, suggest commands
      // Check if some previous words partially match a multi-word command prefix
      const prevJoined = previous.join(' ')

      for (const command of this.commands) {
        if (command._hidden) continue
        if (command.isDefaultCommand) continue

        const cmdName = command.name
        const cmdParts = cmdName.split(' ').filter(Boolean)

        if (cmdParts.length === 0) continue

        // For single-word commands, just check prefix against current
        if (cmdParts.length === 1) {
          if (previous.length === 0 && cmdParts[0].startsWith(current)) {
            if (isZsh) {
              const desc = command.description.split('\n')[0].trim()
              completions.push(desc ? `${escapeColon(cmdParts[0])}:${escapeColon(desc)}` : cmdParts[0])
            } else {
              completions.push(cmdParts[0])
            }
          }
          continue
        }

        // Multi-word commands: check if previous matches the prefix parts
        const matchPrefix = cmdParts.slice(0, -1).join(' ')
        const lastPart = cmdParts[cmdParts.length - 1]
        if (prevJoined === matchPrefix && lastPart.startsWith(current)) {
          if (isZsh) {
            const desc = command.description.split('\n')[0].trim()
            completions.push(desc ? `${escapeColon(lastPart)}:${escapeColon(desc)}` : lastPart)
          } else {
            completions.push(lastPart)
          }
        }
      }

      // Also suggest first words of multi-word commands when at root level
      if (previous.length === 0) {
        const seenFirstWords = new Set<string>()
        for (const command of this.commands) {
          if (command._hidden || command.isDefaultCommand) continue
          const firstWord = command.name.split(' ')[0]
          if (!firstWord || seenFirstWords.has(firstWord)) continue
          // Skip if already added as a single-word command above
          if (completions.some((c) => {
            const name = c.split(':')[0].replace(/\\:/g, ':')
            return name === firstWord
          })) continue
          seenFirstWords.add(firstWord)
          if (firstWord.startsWith(current)) {
            // For first words of multi-word commands, no description (it's a prefix, not a full command)
            completions.push(firstWord)
          }
        }
      }

      // Also include default/root command options at root level
      // (commands with name '' that have their own options)
      const defaultCommands = this.commands.filter((c) => c.isDefaultCommand)
      const defaultOptions = defaultCommands.flatMap((c) => c.options)

      // Suggest global options + default command options when current starts with -
      if (current.startsWith('-') || current === '') {
        const globalAndDefaultOptions = [...this.globalCommand.options, ...defaultOptions]
        const seen = new Set<string>()

        for (const option of globalAndDefaultOptions) {
          if (option.deprecated) continue
          if (seen.has(option.name)) continue
          seen.add(option.name)

          const flag = getLongFlag(option)

          if (current.startsWith('-')) {
            if (!flag.startsWith(current)) continue
          } else if (current !== '') {
            continue
          }

          // Only suggest options when current is - prefixed or empty and no commands matched
          if (current === '' && completions.length > 0 && !current.startsWith('-')) continue

          pushOption(option)
        }
      }
    }

    // Deduplicate
    return [...new Set(completions)]
  }

  /**
   * Parse argv
   */
  parse(
    argv = this.#defaultArgv,
    {
      /** Whether to run the action for matched command */
      run = true,
    } = {}
  ): ParsedArgv {
    this.rawArgs = argv
    if (!this.name) {
      this.name = argv[1] ? getFileName(argv[1]) : 'cli'
    }

    // Intercept --get-goke-completions before any command matching/validation.
    // The shell completion script passes this flag on every Tab press.
    const completionFlagIndex = argv.indexOf(`--${COMPLETION_FLAG}`)
    if (completionFlagIndex !== -1) {
      // Everything after the flag is the words typed so far
      const completionArgs = argv.slice(completionFlagIndex + 1)
      const completions = this.getCompletions(completionArgs)
      for (const c of completions) {
        this.stdout.write(c + '\n')
      }
      this.exit(0)
      return { args: [], options: {} }
    }

    let shouldParse = true

    // Sort by name length (longest first) so "mcp login" matches before "mcp"
    const sortedCommands = [...this.commands].sort((a, b) => {
      const aLength = a.name.split(' ').filter(Boolean).length
      const bLength = b.name.split(' ').filter(Boolean).length
      return bLength - aLength
    })

    // Search sub-commands — mri() can throw coercion errors, catch them
    try {
      for (const command of sortedCommands) {
        const parsed = this.mri(argv.slice(2), command)

        const result = command.isMatched(parsed.args as string[])
        if (result.matched) {
          shouldParse = false
          const matchedCommandName = parsed.args.slice(0, result.consumedArgs).join(' ')
          const parsedInfo = {
            ...parsed,
            args: parsed.args.slice(result.consumedArgs),
          }
          this.setParsedInfo(parsedInfo, command, matchedCommandName)
          this.emit(`command:${matchedCommandName}`, command)
          break // Stop after first match (greedy matching)
        }
      }

      if (shouldParse) {
        // Search the default command
        for (const command of this.commands) {
          if (command.name === '') {
            // Check if any argument is a prefix of an existing command
            // If so, don't match the default command (user probably mistyped a subcommand)
            const parsed = this.mri(argv.slice(2), command)
            const firstArg = parsed.args[0]
            if (firstArg) {
              const isPrefixOfCommand = this.commands.some((cmd) => {
                if (cmd.name === '') return false
                const cmdParts = cmd.name.split(' ')
                return cmdParts[0] === firstArg
              })
              if (isPrefixOfCommand) {
                // Don't match default command - let it fall through to "unknown command"
                continue
              }
            }
            shouldParse = false
            this.setParsedInfo(parsed, command)
            this.emit(`command:!`, command)
          }
        }
      }

      if (shouldParse) {
        const parsed = this.mri(argv.slice(2))
        this.setParsedInfo(parsed)
      }
    } catch (err) {
      if (err instanceof GokeError) {
        this.handleCliError(err)
        this.exit(1)
      }
      throw err
    }

    if (this.options.help && this.showHelpOnExit) {
      if (!this.matchedCommand && this.args[0]) {
        const firstArg = this.args[0]
        const matchingCommands = this.commands.filter((cmd) => {
          if (cmd.name === '') return false
          const cmdParts = cmd.name.split(' ')
          return cmdParts[0] === firstArg
        })

        if (matchingCommands.length > 0) {
          this.outputHelpForPrefix(firstArg, matchingCommands, true)
        } else {
          this.outputHelp()
        }
      } else {
        this.outputHelp()
      }
      run = false
      this.unsetMatchedCommand()
    }

    if (this.options.version && this.showVersionOnExit && this.matchedCommandName == null) {
      this.outputVersion()
      run = false
      this.unsetMatchedCommand()
    }

    const parsedArgv = { args: this.args, options: this.options }

    if (run) {
      this.runMatchedCommand()
    }

    if (!this.matchedCommand && this.args[0] && !(this.options.help && this.showHelpOnExit)) {
      this.emit('command:*')

      // If the first arg is a prefix of existing commands but no command matched,
      // show help automatically (user likely mistyped a subcommand)
      if (this.showHelpOnExit) {
        const firstArg = this.args[0]
        const matchingCommands = this.commands.filter((cmd) => {
          if (cmd.name === '') return false
          const cmdParts = cmd.name.split(' ')
          return cmdParts[0] === firstArg
        })
        if (matchingCommands.length > 0) {
          // Show help for commands starting with this prefix
          this.outputHelpForPrefix(firstArg, matchingCommands)
        } else {
          // Unknown command with no matching prefix: show root help
          this.outputHelp()
        }
      }
    }

    if (
      !this.matchedCommand &&
      this.args.length === 0 &&
      this.showHelpOnExit &&
      !(this.options.help && this.showHelpOnExit)
    ) {
      this.outputHelp()
    }

    return parsedArgv
  }

  private mri(
    argv: string[],
    /** Matched command */ command?: Command
  ): ParsedArgv {
    // All added options
    const cliOptions = [
      ...this.globalCommand.options,
      ...(command ? command.options : []),
    ]
    const mriOptions = getMriOptions(cliOptions)

    // Extract everything after `--` into options['--'].
    // Args after `--` are kept separate from positional args so commands
    // like `run <script> -- --coverage` can distinguish the script name
    // from passthrough args.
    let argsAfterDoubleDashes: string[] = []
    const doubleDashesIndex = argv.indexOf('--')
    if (doubleDashesIndex > -1) {
      argsAfterDoubleDashes = argv.slice(doubleDashesIndex + 1)
      argv = argv.slice(0, doubleDashesIndex)
    }

    let parsed = mri(argv, mriOptions)
    parsed = Object.keys(parsed).reduce(
      (res, name) => {
        return {
          ...res,
          [camelcaseOptionName(name)]: parsed[name],
        }
      },
      { _: [] }
    )

    const args = parsed._

    const options: { [k: string]: any } = {
      '--': argsAfterDoubleDashes,
    }

    // Set option default value
    const ignoreDefault =
      command && command.config.ignoreOptionDefaultValue
        ? command.config.ignoreOptionDefaultValue
        : this.globalCommand.config.ignoreOptionDefaultValue

    // Build a map of option name → JSON Schema for schema-backed options
    const schemaMap = new Map<string, { jsonSchema: Record<string, unknown>; optionName: string }>()

    for (const cliOption of cliOptions) {
      if (!ignoreDefault && cliOption.default !== undefined) {
        for (const name of cliOption.names) {
          // Use setDotProp so dot-nested defaults (e.g. "config.port") produce
          // nested objects ({ config: { port: ... } }) instead of flat keys.
          const keys = name.split('.')
          setDotProp(options, keys, cliOption.default)
        }
      }

      // Extract JSON Schema from StandardJSONSchemaV1-compatible schema
      if (cliOption.schema) {
        const jsonSchema = extractJsonSchema(cliOption.schema)
        if (jsonSchema) {
          schemaMap.set(cliOption.name, { jsonSchema, optionName: cliOption.name })
          // Also register aliases so we can look up by any name
          for (const alias of cliOption.names) {
            schemaMap.set(alias, { jsonSchema, optionName: cliOption.name })
          }
        }
      }
    }

    // Build sets of option names for sentinel detection.
    //
    // When mri returns `true` for value-taking options, it means "flag present, no value given".
    // For required options (<...>), the sentinel is preserved so checkOptionValue() throws.
    // For optional options ([...]) we want a single, uniform shape: `string`
    // with `''` meaning "flag present but no value" — callers get clean
    // `string | undefined` types instead of `string | boolean | undefined`.
    // The `optionsWithDefault` set tracks options whose schema produced a
    // non-undefined default — when the user passes such an option bare, we
    // keep the preset default instead of overwriting it with `undefined`,
    // which matches what the new `HasSchemaDefault` type inference promises.
    const requiredValueOptions = new Set<string>()
    const optionalValueOptions = new Set<string>()
    const optionsWithDefault = new Set<string>()
    for (const cliOption of cliOptions) {
      if (cliOption.required === true) {
        for (const name of cliOption.names) {
          requiredValueOptions.add(name)
        }
      } else if (cliOption.required === false) {
        for (const name of cliOption.names) {
          optionalValueOptions.add(name)
        }
      }
      if (cliOption.default !== undefined) {
        for (const name of cliOption.names) {
          optionsWithDefault.add(name)
        }
      }
    }

    // Set option values (support dot-nested property name)
    // Apply schema-based coercion for options with schemas
    for (const key of Object.keys(parsed)) {
      if (key !== '_') {
        const keys = key.split('.')
        let value = parsed[key]

        // Apply schema coercion if this option has a schema.
        // When value is boolean `true` and the option takes a value, it's mri's sentinel
        // for "flag present, no value given":
        //   - Required options (<...>): preserve `true` so checkOptionValue() throws
        //   - Optional options ([...]) with schema AND a default: skip this
        //     key entirely so the preset default (written into `options` at
        //     the top of this function) survives. This keeps the type-level
        //     `HasSchemaDefault` promise honest at runtime.
        //   - Optional options ([...]) with schema and NO default: replace
        //     `true` with `undefined` so the caller sees "flag present, no value"
        //     as `undefined`.
        const schemaInfo = schemaMap.get(key)
        if (schemaInfo && value !== undefined) {
          if (value === true && requiredValueOptions.has(key)) {
            // Keep sentinel for checkOptionValue() to detect
          } else if (value === true && optionalValueOptions.has(key)) {
            if (optionsWithDefault.has(key)) {
              // Preserve the preset default — don't overwrite with undefined.
              continue
            }
            value = undefined
          } else {
            value = coerceBySchema(value, schemaInfo.jsonSchema, schemaInfo.optionName)
          }
        } else if (value === true && optionalValueOptions.has(key)) {
          // Untyped optional-value flag with no schema: normalize bare `true`
          // to `''` so callers get a clean `string | undefined` shape. `''`
          // means "flag passed with no argument", distinct from `undefined`
          // (flag omitted). This matches the new type inference that treats
          // `[value]` as `string` instead of `string | boolean`.
          value = ''
        }

        setDotProp(options, keys, value)
      }
    }

    return {
      args,
      options,
    }
  }

  runMatchedCommand() {
    const { args, options, matchedCommand: command } = this
    const executionContext = this.createExecutionContext()

    if (!command || !command.commandAction) return

    try {
      command.checkUnknownOptions()
      command.checkOptionValue()
      command.checkRequiredArgs()
    } catch (err) {
      if (err instanceof GokeError) {
        this.handleCliError(err)
        this.exit(1)
      }
      throw err
    }

    const actionArgs: any[] = []
    command.args.forEach((arg, index) => {
      if (arg.variadic) {
        actionArgs.push(args.slice(index))
      } else {
        actionArgs.push(args[index])
      }
    })
    actionArgs.push(options)
    actionArgs.push(executionContext)

    const executeAction = () => command.commandAction!.apply(this, actionArgs)

    const handleAsyncError = (err: unknown) => {
      if (err instanceof Error) {
        this.handleCliError(err)
      } else {
        this.console.error(`${pc.red(pc.bold('error:'))} ${String(err)}`)
      }
      this.exit(1)
    }

    // Run middleware in registration order, then the command action.
    // If any middleware returns a promise, the rest of the chain
    // (remaining middleware + command action) becomes async.
    let asyncChain: Promise<any> | null = null

    for (const mw of this.middlewares) {
      if (asyncChain) {
        asyncChain = asyncChain.then(() => mw.action(options, executionContext))
      } else {
        try {
          const mwResult = mw.action(options, executionContext)
          if (isPromiseLike(mwResult)) {
            asyncChain = mwResult as Promise<any>
          }
        } catch (err) {
          if (err instanceof GokeProcessExit) {
            throw err
          }
          handleAsyncError(err)
          return
        }
      }
    }

    const catchAsyncError = (err: unknown) => {
      if (err instanceof GokeProcessExit) {
        throw err
      }
      handleAsyncError(err)
    }

    if (asyncChain) {
      return asyncChain
        .then(executeAction)
        .catch(catchAsyncError)
    }

    try {
      const result = executeAction()
      return isPromiseLike(result)
        ? (result as Promise<any>).catch(catchAsyncError)
        : result
    } catch (err) {
      if (err instanceof GokeProcessExit) {
        throw err
      }
      handleAsyncError(err)
      return
    }
  }
}

// ─── Doc generation ───

interface DocPage {
  /** The command name, e.g. "event view". Empty string for the root CLI page. */
  command: string
  /** URL-friendly slug, e.g. "event-view". "index" for the root CLI page. */
  slug: string
  /** Full markdown content for this command's documentation page. */
  content: string
}

interface GenerateDocsOptions {
  /** The Goke CLI instance to generate docs from. */
  cli: Goke<any>
}

/**
 * Generate markdown documentation pages for every command in a CLI.
 *
 * Returns one `DocPage` per non-hidden command, plus a root index page
 * that lists all available commands. Each page includes an arguments table,
 * options table, global options, and examples when available.
 *
 * @example
 * ```ts
 * import { goke, generateDocs } from 'goke'
 * import fs from 'node:fs'
 *
 * const cli = goke('mycli')
 *   .command('deploy <env>', 'Deploy to an environment')
 *   .option('--force', 'Skip confirmation')
 *
 * const pages = generateDocs({ cli })
 * for (const page of pages) {
 *   fs.writeFileSync(`docs/${page.slug}.md`, page.content)
 * }
 * ```
 */
function generateDocs({ cli }: GenerateDocsOptions): DocPage[] {
  const pages: DocPage[] = []

  // Collect global options (from globalCommand), excluding deprecated
  const globalOptions = cli.globalCommand.options.filter((o) => !o.deprecated)

  // Root index page listing all commands
  const visibleCommands = cli.commands.filter((cmd) => !cmd._hidden)
  if (visibleCommands.length > 0) {
    const lines: string[] = []
    lines.push(`# ${cli.name}`)
    lines.push('')

    const { versionNumber } = cli.globalCommand
    if (versionNumber) {
      lines.push(`Version: ${versionNumber}`)
      lines.push('')
    }

    lines.push('## Commands')
    lines.push('')
    lines.push('| Command | Description |')
    lines.push('|---------|-------------|')
    for (const cmd of visibleCommands) {
      if (cmd.isDefaultCommand) continue
      const desc = cmd.description.split('\n')[0].trim()
      const slug = cmd.name.replace(/\s+/g, '-')
      lines.push(`| [\`${cmd.name}\`](./${slug}.md) | ${desc} |`)
    }
    lines.push('')

    if (globalOptions.length > 0) {
      lines.push('## Global Options')
      lines.push('')
      lines.push(formatOptionsTable(globalOptions))
      lines.push('')
    }

    pages.push({ command: '', slug: 'index', content: lines.join('\n') })
  }

  // One page per command
  for (const cmd of visibleCommands) {
    if (cmd.isDefaultCommand) continue
    const lines: string[] = []
    const title = cmd.name
    lines.push(`# ${title}`)
    lines.push('')

    if (cmd.description) {
      lines.push(cmd.description)
      lines.push('')
    }

    // Usage line
    const usage = cmd.usageText || cmd.rawName
    lines.push('## Usage')
    lines.push('')
    lines.push('```sh')
    lines.push(`${cli.name} ${usage}`)
    lines.push('```')
    lines.push('')

    // Arguments table
    if (cmd.args.length > 0) {
      lines.push('## Arguments')
      lines.push('')
      lines.push('| Argument | Required | Description |')
      lines.push('|----------|----------|-------------|')
      for (const arg of cmd.args) {
        const bracket = arg.required
          ? `<${arg.variadic ? '...' : ''}${arg.value}>`
          : `[${arg.variadic ? '...' : ''}${arg.value}]`
        const required = arg.required ? 'Yes' : 'No'
        const desc = arg.variadic ? `${arg.value} (variadic)` : arg.value
        lines.push(`| \`${bracket}\` | ${required} | ${desc} |`)
      }
      lines.push('')
    }

    // Command-specific options
    const cmdOptions = cmd.options.filter((o) => !o.deprecated)
    if (cmdOptions.length > 0) {
      lines.push('## Options')
      lines.push('')
      lines.push(formatOptionsTable(cmdOptions))
      lines.push('')
    }

    // Global options section
    if (globalOptions.length > 0) {
      lines.push('## Global Options')
      lines.push('')
      lines.push(formatOptionsTable(globalOptions))
      lines.push('')
    }

    // Examples
    if (cmd.examples.length > 0) {
      lines.push('## Examples')
      lines.push('')
      for (const example of cmd.examples) {
        const text = typeof example === 'function' ? example(cli.name) : example
        // Auto-wrap in ```sh if not already fenced
        if (text.trimStart().startsWith('```')) {
          lines.push(text)
        } else {
          lines.push('```sh')
          lines.push(text)
          lines.push('```')
        }
        lines.push('')
      }
    }

    const slug = cmd.name.replace(/\s+/g, '-')
    pages.push({ command: cmd.name, slug, content: lines.join('\n') })
  }

  return pages
}

function formatOptionsTable(options: Option[]): string {
  const lines: string[] = []
  lines.push('| Option | Default | Description |')
  lines.push('|--------|---------|-------------|')
  for (const opt of options) {
    const defaultVal = opt.default !== undefined ? `\`${String(opt.default)}\`` : '-'
    // Escape pipe characters in description for markdown tables
    const desc = opt.description.replace(/\|/g, '\\|').replace(/\n/g, ' ')
    lines.push(`| \`${opt.rawName}\` | ${defaultVal} | ${desc} |`)
  }
  return lines.join('\n')
}

// ─── Exports ───

export type { GokeOutputStream, GokeConsole, GokeOptions, GokeProcess, GokeExecutionContext, GokeExecutionContextOverride, GokeFs, DocPage, GenerateDocsOptions }
export { createConsole, Command, GokeProcessExit, openInBrowser, generateDocs }
export type { ShellType }
export { generateCompletionScript, installCompletions, uninstallCompletions, detectShell, detectCompletionShell, validateShell }
export default Goke
