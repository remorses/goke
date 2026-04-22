/**
 * Type-level tests for schema-based option inference.
 * These tests verify that TypeScript infers the correct types from
 * option names (template literals) and StandardJSONSchemaV1 schemas,
 * and that `.action()` callbacks receive fully-typed positional args
 * and options objects.
 *
 * These use expectTypeOf from vitest for compile-time type assertions.
 */
import { describe, test, expectTypeOf } from 'vitest'
import { z } from 'zod'
import type { StandardTypedV1, StandardJSONSchemaV1 } from '../coerce.js'
import type { GokeExecutionContext } from '../goke.js'
import goke from '../index.js'

// ─── Import type helpers from Command.ts ───
// We can't import the private types directly, so we reconstruct them here
// to verify the type-level logic works correctly.

type CamelCase<S extends string> =
  S extends `${infer L}-${infer R}`
    ? `${L}${CamelCase<Capitalize<R>>}`
    : S

type ExtractOptionName<S extends string> =
  S extends `${string}--${infer Name} <${string}>` ? CamelCase<Name> :
  S extends `${string}--${infer Name} [${string}]` ? CamelCase<Name> :
  S extends `${string}--${infer Name}` ? CamelCase<Name> :
  string

type IsOptionalOption<S extends string> =
  S extends `${string}<${string}>` ? false :
  true

type InferSchemaOutput<S> =
  S extends StandardTypedV1<any, infer O> ? O : unknown

describe('type-level: ExtractOptionName', () => {
  test('extracts name from --name <value>', () => {
    expectTypeOf<ExtractOptionName<'--port <port>'>>().toEqualTypeOf<'port'>()
  })

  test('extracts name from --name [value]', () => {
    expectTypeOf<ExtractOptionName<'--host [host]'>>().toEqualTypeOf<'host'>()
  })

  test('extracts name from --name (boolean)', () => {
    expectTypeOf<ExtractOptionName<'--verbose'>>().toEqualTypeOf<'verbose'>()
  })

  test('extracts name with alias -p, --port <port>', () => {
    expectTypeOf<ExtractOptionName<'-p, --port <port>'>>().toEqualTypeOf<'port'>()
  })

  test('camelCases kebab-case names', () => {
    expectTypeOf<ExtractOptionName<'--foo-bar <val>'>>().toEqualTypeOf<'fooBar'>()
  })

  test('camelCases multi-segment kebab-case', () => {
    expectTypeOf<ExtractOptionName<'--my-long-option <val>'>>().toEqualTypeOf<'myLongOption'>()
  })

})

describe('type-level: IsOptionalOption', () => {
  test('required option with <...>', () => {
    expectTypeOf<IsOptionalOption<'--port <port>'>>().toEqualTypeOf<false>()
  })

  test('optional option with [...]', () => {
    expectTypeOf<IsOptionalOption<'--host [host]'>>().toEqualTypeOf<true>()
  })

  test('boolean flag is optional', () => {
    expectTypeOf<IsOptionalOption<'--verbose'>>().toEqualTypeOf<true>()
  })
})

// Every action callback's options param is extended with `{ '--': string[] }`
// because the runtime always populates that key. Use this alias everywhere
// we used to write `{}` to mean "no user-declared options".
type Base = { '--': string[] }

describe('type-level: InferSchemaOutput', () => {
  test('infers output from StandardTypedV1', () => {
    type Schema = StandardTypedV1<unknown, number>
    expectTypeOf<InferSchemaOutput<Schema>>().toEqualTypeOf<number>()
  })

  test('infers string output', () => {
    type Schema = StandardTypedV1<unknown, string>
    expectTypeOf<InferSchemaOutput<Schema>>().toEqualTypeOf<string>()
  })

  test('infers boolean output', () => {
    type Schema = StandardTypedV1<unknown, boolean>
    expectTypeOf<InferSchemaOutput<Schema>>().toEqualTypeOf<boolean>()
  })

  test('falls back to unknown for non-schema', () => {
    expectTypeOf<InferSchemaOutput<{ foo: string }>>().toEqualTypeOf<unknown>()
  })
})

describe('type-level: CamelCase', () => {
  test('simple kebab', () => {
    expectTypeOf<CamelCase<'foo-bar'>>().toEqualTypeOf<'fooBar'>()
  })

  test('multi-segment', () => {
    expectTypeOf<CamelCase<'foo-bar-baz'>>().toEqualTypeOf<'fooBarBaz'>()
  })

  test('no hyphens passthrough', () => {
    expectTypeOf<CamelCase<'port'>>().toEqualTypeOf<'port'>()
  })

  test('single char segments', () => {
    expectTypeOf<CamelCase<'a-b-c'>>().toEqualTypeOf<'aBC'>()
  })
})

describe('type-level: middleware use() callback inference', () => {
  test('use() callback receives accumulated option types', () => {
    const schema1 = {} as StandardJSONSchemaV1<unknown, number>
    const schema2 = {} as StandardJSONSchemaV1<unknown, string>

    goke('test')
      .option('--port <port>', schema1)
      .option('--host <host>', schema2)
      .use((options, { console, fs, process }) => {
        expectTypeOf(options.port).toEqualTypeOf<number>()
        expectTypeOf(options.host).toEqualTypeOf<string>()
        expectTypeOf(fs.mkdir).toBeFunction()
        expectTypeOf(process.argv).toEqualTypeOf<string[]>()
        expectTypeOf(process.cwd).toEqualTypeOf<string>()
        expectTypeOf(process.env).toEqualTypeOf<Record<string, string | undefined>>()
        expectTypeOf(process.stdin).toEqualTypeOf<string>()
        expectTypeOf(process.stdout.write).toEqualTypeOf<(data: string) => void>()
        expectTypeOf(console.log).toBeFunction()
      })
  })

  test('use() only sees options declared before it', () => {
    const schema1 = {} as StandardJSONSchemaV1<unknown, boolean>
    const schema2 = {} as StandardJSONSchemaV1<unknown, number>

    goke('test')
      .option('--verbose', schema1)
      .use((options, { fs, process }) => {
        expectTypeOf(options.verbose).toEqualTypeOf<boolean | undefined>()
        expectTypeOf(fs.writeFile).toBeFunction()
        expectTypeOf(process.exit).toEqualTypeOf<(code: number) => void>()
        // @ts-expect-error port is not declared yet
        options.port
      })
      .option('--port <port>', schema2)
      .use((options, { console }) => {
        // Now both are visible
        expectTypeOf(options.verbose).toEqualTypeOf<boolean | undefined>()
        expectTypeOf(options.port).toEqualTypeOf<number>()
        expectTypeOf(console.error).toBeFunction()
      })
  })

  test('accessing a non-existent option is a type error', () => {
    const schema = {} as StandardJSONSchemaV1<unknown, number>

    goke('test')
      .option('--port <port>', schema)
      .use((options, { fs, process }) => {
        expectTypeOf(fs.readFile).toBeFunction()
        expectTypeOf(process.stderr.write).toEqualTypeOf<(data: string) => void>()
        // @ts-expect-error nonExistent was never defined
        options.nonExistent
      })
  })
})

describe('type-level: command() .action() positional args inference', () => {
  test('command with no args → action receives only (options, ctx)', () => {
    goke('test')
      .command('deploy', 'Deploy the app')
      .action((options, ctx) => {
        expectTypeOf(options).toEqualTypeOf<Base>()
        expectTypeOf(ctx).toEqualTypeOf<GokeExecutionContext>()
      })
  })

  test('command with one required arg → action receives (arg, options, ctx)', () => {
    goke('test')
      .command('get <id>', 'Fetch a resource by id')
      .action((id, options, ctx) => {
        expectTypeOf(id).toEqualTypeOf<string>()
        expectTypeOf(options).toEqualTypeOf<Base>()
        expectTypeOf(ctx).toEqualTypeOf<GokeExecutionContext>()
      })
  })

  test('command with two required args → action receives both as strings', () => {
    goke('test')
      .command('convert <input> <output>', 'Convert file formats')
      .action((input, output, options) => {
        expectTypeOf(input).toEqualTypeOf<string>()
        expectTypeOf(output).toEqualTypeOf<string>()
        expectTypeOf(options).toEqualTypeOf<Base>()
      })
  })

  test('command with optional arg → arg type includes undefined', () => {
    goke('test')
      .command('run [script]', 'Run a script')
      .action((script, options) => {
        expectTypeOf(script).toEqualTypeOf<string | undefined>()
        expectTypeOf(options).toEqualTypeOf<Base>()
      })
  })

  test('command with variadic required arg → arg is string[]', () => {
    goke('test')
      .command('exec <...args>', 'Run a binary with args')
      .action((args, options) => {
        expectTypeOf(args).toEqualTypeOf<string[]>()
        expectTypeOf(options).toEqualTypeOf<Base>()
      })
  })

  test('command with variadic optional arg → arg is string[]', () => {
    goke('test')
      .command('run [...rest]', 'Variadic optional')
      .action((rest, options) => {
        expectTypeOf(rest).toEqualTypeOf<string[]>()
        expectTypeOf(options).toEqualTypeOf<Base>()
      })
  })

  test('multi-word command with required arg', () => {
    goke('test')
      .command('mcp getNodeXml <id>', 'Get XML for a node')
      .action((id, options) => {
        expectTypeOf(id).toEqualTypeOf<string>()
        expectTypeOf(options).toEqualTypeOf<Base>()
      })
  })

  test('default command with one positional arg', () => {
    goke('test')
      .command('<file>', 'Default command')
      .action((file, options) => {
        expectTypeOf(file).toEqualTypeOf<string>()
        expectTypeOf(options).toEqualTypeOf<Base>()
      })
  })

  test('mixed required and optional positional args', () => {
    goke('test')
      .command('send <to> [cc]', 'Send a message')
      .action((to, cc, options) => {
        expectTypeOf(to).toEqualTypeOf<string>()
        expectTypeOf(cc).toEqualTypeOf<string | undefined>()
        expectTypeOf(options).toEqualTypeOf<Base>()
      })
  })
})

describe('type-level: command() .action() option inference', () => {
  test('single schema-based option is visible on options param', () => {
    goke('test')
      .command('serve', 'Start server')
      .option('--port <port>', z.number())
      .action((options, ctx) => {
        expectTypeOf(options.port).toEqualTypeOf<number>()
        expectTypeOf(ctx).toEqualTypeOf<GokeExecutionContext>()
      })
  })

  test('multiple schema-based options are accumulated', () => {
    goke('test')
      .command('serve', 'Start server')
      .option('--port <port>', z.number())
      .option('--host <host>', z.string())
      .option('--verbose', z.boolean())
      .action((options) => {
        expectTypeOf(options.port).toEqualTypeOf<number>()
        expectTypeOf(options.host).toEqualTypeOf<string>()
        // Boolean flag is optional (no <...> brackets)
        expectTypeOf(options.verbose).toEqualTypeOf<boolean | undefined>()
      })
  })

  test('required vs optional option shape', () => {
    goke('test')
      .command('cmd', 'Command')
      .option('--name <name>', z.string())
      .option('--count [count]', z.number())
      .action((options) => {
        expectTypeOf(options.name).toEqualTypeOf<string>()
        expectTypeOf(options.count).toEqualTypeOf<number | undefined>()
      })
  })

  test('camelCase conversion for kebab-case option names', () => {
    goke('test')
      .command('build', 'Build')
      .option('--out-dir <dir>', z.string())
      .option('--my-long-flag <val>', z.string())
      .action((options) => {
        expectTypeOf(options.outDir).toEqualTypeOf<string>()
        expectTypeOf(options.myLongFlag).toEqualTypeOf<string>()
      })
  })

  test('options combined with positional args', () => {
    goke('test')
      .command('convert <input> <output>', 'Convert file format')
      .option('--quality <quality>', z.number())
      .option('--format <format>', z.enum(['png', 'jpg', 'webp']))
      .action((input, output, options, ctx) => {
        expectTypeOf(input).toEqualTypeOf<string>()
        expectTypeOf(output).toEqualTypeOf<string>()
        expectTypeOf(options.quality).toEqualTypeOf<number>()
        expectTypeOf(options.format).toEqualTypeOf<'png' | 'jpg' | 'webp'>()
        expectTypeOf(ctx).toEqualTypeOf<GokeExecutionContext>()
      })
  })

  test('global options from Goke are visible inside command actions', () => {
    goke('test')
      .option('--verbose', z.boolean())
      .command('serve', 'Start server')
      .option('--port <port>', z.number())
      .action((options) => {
        // Global option from cli.option()
        expectTypeOf(options.verbose).toEqualTypeOf<boolean | undefined>()
        // Command-local option
        expectTypeOf(options.port).toEqualTypeOf<number>()
      })
  })

  test('untyped option (string description) produces loose value type', () => {
    goke('test')
      .command('serve', 'Start server')
      .option('--port <port>', 'Port number')
      .action((options) => {
        // Without a schema the runtime still guarantees required value options are strings.
        expectTypeOf(options.port).toEqualTypeOf<string>()
      })
  })

  test('untyped optional value options surface as string | undefined', () => {
    goke('test')
      .command('serve', 'Start server')
      .option('--host [host]', 'Optional host override')
      .option('--verbose', 'Verbose output')
      .action((options) => {
        // `[value]` options always resolve to `string | undefined`:
        //   - omitted           → undefined
        //   - `--host`          → ''  (flag present, no value)
        //   - `--host example`  → 'example'
        expectTypeOf(options.host).toEqualTypeOf<string | undefined>()
        expectTypeOf(options.verbose).toEqualTypeOf<boolean | undefined>()
      })
  })

  test('schema with .default() on [value] is typed as required', () => {
    // `z.number().default(30)` has Standard Schema input `number | undefined`
    // but output `number`, so goke recognizes it as "effectively required"
    // even though the bracket syntax is `[...]`. The property should NOT
    // be optional in the action options — the runtime always produces 30
    // when the flag is omitted or passed bare.
    goke('test')
      .command('list', 'List stuff')
      .option('--limit [n]', z.number().default(30).describe('Max items'))
      .option('--sort [mode]', z.enum(['asc', 'desc']).default('asc'))
      .action((options) => {
        expectTypeOf(options.limit).toEqualTypeOf<number>()
        expectTypeOf(options.sort).toEqualTypeOf<'asc' | 'desc'>()
      })
  })

  test('schema without .default() on [value] stays optional', () => {
    // Without a default, `[value]` remains genuinely optional at the type
    // level — bare flag or omitted flag both produce `undefined`.
    goke('test')
      .command('list', 'List stuff')
      .option('--limit [n]', z.number().describe('Max items'))
      .option('--filter [pattern]', z.string())
      .action((options) => {
        expectTypeOf(options.limit).toEqualTypeOf<number | undefined>()
        expectTypeOf(options.filter).toEqualTypeOf<string | undefined>()
      })
  })

  test('z.string().optional() on [value] stays optional (no default)', () => {
    // `.optional()` makes both input and output allow undefined, so
    // HasSchemaDefault is false and the bracket-based optionality wins.
    goke('test')
      .command('serve', 'Start server')
      .option('--host [host]', z.string().optional().describe('Host'))
      .action((options) => {
        expectTypeOf(options.host).toEqualTypeOf<string | undefined>()
      })
  })

  test('.default() combined with .optional() stays optional', () => {
    // `z.number().default(30).optional()` has Input `number | undefined` AND
    // Output `number | undefined`, so HasSchemaDefault is false — the user
    // explicitly opted out of the default-inferred-as-required behavior by
    // re-adding `.optional()`.
    goke('test')
      .command('list', 'List stuff')
      .option('--limit [n]', z.number().default(30).optional())
      .action((options) => {
        expectTypeOf(options.limit).toEqualTypeOf<number | undefined>()
      })
  })

  test('.default() on <required> is typed as required output', () => {
    // With `<value>` syntax the property is already required; the schema
    // default just narrows the output type. This is the "old" behavior.
    goke('test')
      .command('serve', 'Start server')
      .option('--port <port>', z.number().default(3000))
      .action((options) => {
        expectTypeOf(options.port).toEqualTypeOf<number>()
      })
  })

  test('accessing a non-existent option in action is a type error', () => {
    goke('test')
      .command('serve', 'Start server')
      .option('--port <port>', z.number())
      .action((options) => {
        expectTypeOf(options.port).toEqualTypeOf<number>()
        // @ts-expect-error nonExistent was never declared
        options.nonExistent
      })
  })

  test('accessing a non-existent positional arg in action is a type error', () => {
    goke('test')
      .command('get <id>', 'Fetch resource')
      .action((id, options, ctx, ...rest) => {
        expectTypeOf(id).toEqualTypeOf<string>()
        expectTypeOf(options).toEqualTypeOf<Base>()
        expectTypeOf(ctx).toEqualTypeOf<GokeExecutionContext>()
        // No more positional slots — rest should be empty
        expectTypeOf(rest).toEqualTypeOf<[]>()
      })
  })

  test('action callback can omit trailing params (fewer-args is valid)', () => {
    // Dropping context is fine
    goke('test')
      .command('serve', 'Start server')
      .option('--port <port>', z.number())
      .action((options) => {
        expectTypeOf(options.port).toEqualTypeOf<number>()
      })

    // Dropping everything is fine
    goke('test')
      .command('serve', 'Start server')
      .option('--port <port>', z.number())
      .action(() => {})
  })
})

describe('type-level: README TypeScript examples', () => {
  test('README TypeScript example infers positional args and typed options', () => {
    goke('my-program')
      .command('serve <entry>', 'Start the app')
      .option('--port <port>', z.number().default(3000).describe('Port number'))
      .option('--watch', 'Watch files')
      .action((entry, options, { console, process }) => {
        expectTypeOf(entry).toEqualTypeOf<string>()
        expectTypeOf(options.port).toEqualTypeOf<number>()
        expectTypeOf(options.watch).toEqualTypeOf<boolean | undefined>()
        expectTypeOf(console.log).toBeFunction()
        expectTypeOf(process.cwd).toEqualTypeOf<string>()
      })
  })

  test('use() with sub-CLI preserves parent middleware typing', () => {
    const sub = goke()
    sub
      .command('deploy', 'Deploy the app')
      .option('--force', z.boolean())
      .action((options) => {
        // Sub-CLI command's action sees its own options
        expectTypeOf(options.force).toEqualTypeOf<boolean | undefined>()
      })

    goke('test')
      .option('--verbose', z.boolean().default(false).describe('Verbose'))
      .use(sub)
      .use((options) => {
        // Parent middleware still sees parent's accumulated options after .use(subCli)
        expectTypeOf(options.verbose).toEqualTypeOf<boolean>()
      })
      .command('build', 'Build')
      .option('--target <target>', z.string())
      .action((options) => {
        // Parent's inline command still sees global options
        expectTypeOf(options.verbose).toEqualTypeOf<boolean>()
        expectTypeOf(options.target).toEqualTypeOf<string>()
      })
  })

  test('use() with sub-CLI does not leak sub-CLI types to parent', () => {
    const sub = goke()
      .option('--sub-only <val>', z.string())
    sub.command('sub-cmd', 'Sub command').action(() => {})

    goke('test')
      .option('--parent-only <val>', z.number())
      .use(sub)
      .use((options) => {
        expectTypeOf(options.parentOnly).toEqualTypeOf<number>()
        // @ts-expect-error subOnly is not declared on the parent
        options.subOnly
      })
  })

  test('README global options and middleware example stays typed end-to-end', () => {
    // `z.boolean().default(false)` and `z.string().default(...)` are
    // effectively required at runtime: the default applies when the flag is
    // omitted or passed bare, so goke types the property as required (no
    // `| undefined`). Raw untyped boolean flags like `--dry-run` stay
    // `boolean | undefined`.
    goke('mycli')
      .option('--verbose', z.boolean().default(false).describe('Enable verbose logging'))
      .option('--api-url [url]', z.string().default('https://api.example.com').describe('API base URL'))
      .use((options, { process }) => {
        expectTypeOf(options.verbose).toEqualTypeOf<boolean>()
        expectTypeOf(options.apiUrl).toEqualTypeOf<string>()
        expectTypeOf(process.stdin).toEqualTypeOf<string>()
      })
      .command('deploy <env>', 'Deploy to an environment')
      .option('--dry-run', 'Preview without deploying')
      .action((env, options, ctx) => {
        expectTypeOf(env).toEqualTypeOf<string>()
        expectTypeOf(options.verbose).toEqualTypeOf<boolean>()
        expectTypeOf(options.apiUrl).toEqualTypeOf<string>()
        expectTypeOf(options.dryRun).toEqualTypeOf<boolean | undefined>()
        expectTypeOf(ctx).toEqualTypeOf<GokeExecutionContext>()
      })
  })
})
