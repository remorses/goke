import Goke from "./goke.js"
import Option, { OptionConfig } from "./Option.js"
import {
  removeBrackets,
  findAllBrackets,
  findLongest,
  padRight,
  GokeError,
} from "./utils.js"
import { platformInfo } from "./node.js"
import type { StandardTypedV1, StandardJSONSchemaV1 } from "./standard-schema.js"

// ─── Type-level helpers for inferring option names and types ───

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
  S extends StandardTypedV1<any, infer O> ? O : unknown

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
   * When a `schema` implementing StandardJSONSchemaV1 is provided, the option's
   * type is inferred from the schema and the option name is extracted from rawName.
   *
   * @example
   * ```ts
   * // With Zod v4.2+ (implements StandardJSONSchemaV1):
   * cmd.option('--port <port>', 'Port number', { schema: z.number() })
   *
   * // Without schema (no type inference, values are raw strings/booleans):
   * cmd.option('--verbose', 'Verbose output')
   * ```
   */
  option<
    RawName extends string,
    S extends StandardJSONSchemaV1
  >(rawName: RawName, description: string, config: OptionConfig & { schema: S }): Command & { __opts: OptionEntry<RawName, S> }
  option(rawName: string, description: string, config?: OptionConfig): this
  option(rawName: string, description: string, config?: OptionConfig): any {
    const option = new Option(rawName, description, config)
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
        body: `${name}${versionNumber ? `/${versionNumber}` : ''}`,
      },
    ]

    sections.push({
      title: 'Usage',
      body: `  $ ${name} ${this.usageText || this.rawName}`,
    })

    const showCommands =
      (this.isGlobalCommand || this.isDefaultCommand) && commands.length > 0

    if (showCommands) {
      const longestCommandName = findLongest(
        commands.map((command) => command.rawName)
      )
      sections.push({
        title: 'Commands',
        body: commands
          .map((command) => {
            // Only show first line of description in commands listing
            const firstLine = command.description.split('\n')[0].trim()
            return `  ${padRight(
              command.rawName,
              longestCommandName.length
            )}  ${firstLine}`
          })
          .join('\n'),
      })
      sections.push({
        title: `For more info, run any command with the \`--help\` flag`,
        body: commands
          .map(
            (command) =>
              `  $ ${name}${
                command.name === '' ? '' : ` ${command.name}`
              } --help`
          )
          .join('\n'),
      })
    }

    let options = this.isGlobalCommand
      ? globalOptions
      : [...this.options, ...(globalOptions || [])]
    if (!this.isGlobalCommand && !this.isDefaultCommand) {
      options = options.filter((option) => option.name !== 'version')
    }
    if (options.length > 0) {
      const longestOptionName = findLongest(
        options.map((option) => option.rawName)
      )
      sections.push({
        title: 'Options',
        body: options
          .map((option) => {
            return `  ${padRight(option.rawName, longestOptionName.length)}  ${
              option.description
            } ${
              option.config.default === undefined
                ? ''
                : `(default: ${option.config.default})`
            }`
          })
          .join('\n'),
      })
    }

    // Show full description for specific commands (not global/default)
    if (!this.isGlobalCommand && !this.isDefaultCommand && this.description) {
      sections.push({
        title: 'Description',
        body: this.description
          .split('\n')
          .map((line) => `  ${line}`)
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
            ? `${section.title}:\n${section.body}`
            : section.body
        })
        .join('\n\n')
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

export type { HelpCallback, CommandExample, CommandConfig }

export { GlobalCommand }

export default Command
