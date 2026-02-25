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

import { EventEmitter } from 'events'
import pc from 'picocolors'
import mri from "./mri.js"
import { GokeError, coerceBySchema, extractJsonSchema, extractSchemaMetadata, isStandardSchema } from "./coerce.js"
import type { StandardJSONSchemaV1 } from "./coerce.js"

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

const commandGreen = (value: string) => pc.bold(pc.greenBright(value))

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
 * Infer the output type from a StandardTypedV1-compatible schema.
 */
type InferSchemaOutput<S> =
  S extends { readonly "~standard": { readonly types?: { readonly output: infer O } } } ? O : unknown

/**
 * Build the option type entry for a single .option() call.
 * Required options (<...>) produce a required key.
 * Optional options ([...]) and boolean flags produce an optional key.
 */
type OptionEntry<RawName extends string, Schema> =
  IsOptionalOption<RawName> extends true
    ? { [K in ExtractOptionName<RawName>]?: InferSchemaOutput<Schema> }
    : { [K in ExtractOptionName<RawName>]: InferSchemaOutput<Schema> }

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

class Command {
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

  constructor(
    public rawName: string,
    public description: string,
    public config: CommandConfig = {},
    public cli: Goke
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
   * the JSON Schema automatically.
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
    RawName extends string,
    S extends StandardJSONSchemaV1
  >(rawName: RawName, schema: S): Command & { __opts: OptionEntry<RawName, S> }
  option(rawName: string, descriptionOrSchema?: string | StandardJSONSchemaV1): this
  option(rawName: string, descriptionOrSchema?: string | StandardJSONSchemaV1): any {
    const option = new Option(rawName, descriptionOrSchema)
    this.options.push(option)
    return this
  }

  alias(name: string) {
    this.aliasNames.push(name)
    return this
  }

  action(callback: (...args: any[]) => any) {
    this.commandAction = callback
    return this
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

  outputHelp() {
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
      const commandRows = commands.map((command) => {
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

    this.cli.console.log(
      sections
        .map((section) => {
          return section.title
            ? `${pc.bold(pc.blue(section.title))}:\n${section.body}`
            : section.body
        })
        .join('\n\n\n')
    )
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
  constructor(cli: Goke) {
    super('@@global@@', '', {}, cli)
  }
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
}

/**
 * Options for configuring a Goke CLI instance.
 */
interface GokeOptions {
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

class Goke extends EventEmitter {
  /** The program name to display in help and version message */
  name: string
  commands: Command[]
  globalCommand: GlobalCommand
  matchedCommand?: Command
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
    this.rawArgs = []
    this.args = []
    this.options = {}
    this.stdout = options?.stdout ?? process.stdout
    this.stderr = options?.stderr ?? process.stderr
    this.console = createConsole(this.stdout, this.stderr)
    this.columns = options?.columns ?? process.stdout.columns ?? Number.POSITIVE_INFINITY
    this.exit = options?.exit ?? ((code: number) => process.exit(code))
    this.#defaultArgv = options?.argv ?? processArgs
    this.globalCommand = new GlobalCommand(this)
    this.globalCommand.usage('<command> [options]')
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
   * Add a sub-command
   */
  command(rawName: string, description?: string, config?: CommandConfig) {
    const command = new Command(rawName, description || '', config, this)
    command.globalCommand = this.globalCommand
    this.commands.push(command)
    return command
  }

  /**
   * Add a global CLI option.
   *
   * Which is also applied to sub-commands.
   */
  option(rawName: string, descriptionOrSchema?: string | StandardJSONSchemaV1) {
    this.globalCommand.option(rawName, descriptionOrSchema as any)
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
   * Output the corresponding help message
   * When a sub-command is matched, output the help message for the command
   * Otherwise output the global one.
   *
   */
  outputHelp() {
    if (this.matchedCommand) {
      this.matchedCommand.outputHelp()
    } else {
      this.globalCommand.outputHelp()
    }
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

    // Extract everything after `--` since mri doesn't support it
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
    // For optional options ([...]) with a schema, we replace `true` with `undefined`.
    const requiredValueOptions = new Set<string>()
    const optionalValueOptions = new Set<string>()
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
        //   - Optional options ([...]) with schema: replace with `undefined` (no typed value)
        //   - Optional options ([...]) without schema: preserve `true` (original goke behavior)
        const schemaInfo = schemaMap.get(key)
        if (schemaInfo && value !== undefined) {
          if (value === true && requiredValueOptions.has(key)) {
            // Keep sentinel for checkOptionValue() to detect
          } else if (value === true && optionalValueOptions.has(key)) {
            // Optional value not given — schema expects a typed value, so return undefined
            value = undefined
          } else {
            value = coerceBySchema(value, schemaInfo.jsonSchema, schemaInfo.optionName)
          }
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

    const result = command.commandAction.apply(this, actionArgs)

    // If the action returns a promise, catch async errors
    if (result && typeof result === 'object' && typeof result.catch === 'function') {
      result.catch((err: unknown) => {
        if (err instanceof Error) {
          this.handleCliError(err)
        } else {
          this.console.error(`${pc.red(pc.bold('error:'))} ${String(err)}`)
        }
        this.exit(1)
      })
    }

    return result
  }
}

// ─── Exports ───

export type { GokeOutputStream, GokeConsole, GokeOptions }
export { createConsole, Command }
export default Goke
