import { describe, test, expect } from 'vitest'
import goke from '../index.js'
import { coerceBySchema } from '../coerce.js'
import { z } from 'zod'

test('double dashes', () => {
  const cli = goke()

  const { args, options } = cli.parse([
    'node',
    'bin',
    'foo',
    'bar',
    '--',
    'npm',
    'test',
  ])

  expect(args).toEqual(['foo', 'bar'])
  expect(options['--']).toEqual(['npm', 'test'])
})

test('dot-nested options', () => {
  const cli = goke()

  cli
    .option('--externals <external>', 'Add externals')
    .option('--scale [level]', 'Scaling level')

  const { options: options1 } = cli.parse(
    `node bin --externals.env.prod production --scale`.split(' ')
  )
  expect(options1.externals).toEqual({ env: { prod: 'production' } })
  expect(options1.scale).toEqual(true)
})

describe('schema-based options', () => {
  test('schema coerces string to number', () => {
    const cli = goke()

    cli.option('--port <port>', 'Port number', {
      schema: z.number(),
    })

    const { options } = cli.parse('node bin --port 3000'.split(' '))
    expect(options.port).toBe(3000)
    expect(typeof options.port).toBe('number')
  })

  test('schema preserves string (no auto-conversion to number)', () => {
    const cli = goke()

    cli.option('--id <id>', 'ID', {
      schema: z.string(),
    })

    const { options } = cli.parse('node bin --id 00123'.split(' '))
    expect(options.id).toBe('00123')
    expect(typeof options.id).toBe('string')
  })

  test('schema coerces string to integer', () => {
    const cli = goke()

    cli.option('--count <count>', 'Count', {
      schema: z.int(),
    })

    const { options } = cli.parse('node bin --count 42'.split(' '))
    expect(options.count).toBe(42)
  })

  test('schema parses JSON object', () => {
    const cli = goke()

    cli.option('--config <config>', 'Config', {
      schema: z.looseObject({}),
    })

    const { options } = cli.parse(['node', 'bin', '--config', '{"a":1}'])
    expect(options.config).toEqual({ a: 1 })
  })

  test('schema parses JSON array', () => {
    const cli = goke()

    cli.option('--items <items>', 'Items', {
      schema: z.array(z.unknown()),
    })

    const { options } = cli.parse(['node', 'bin', '--items', '[1,2,3]'])
    expect(options.items).toEqual([1, 2, 3])
  })

  test('schema throws on invalid number', () => {
    const cli = goke()

    cli.option('--port <port>', 'Port number', {
      schema: z.number(),
    })

    expect(() => cli.parse('node bin --port abc'.split(' ')))
      .toThrow('expected number, got "abc"')
  })

  test('schema with union type ["number", "string"]', () => {
    const cli = goke()

    cli.option('--val <val>', 'Value', {
      schema: z.union([z.number(), z.string()]),
    })

    const { options: opts1 } = cli.parse('node bin --val 123'.split(' '))
    expect(opts1.val).toBe(123)

    const { options: opts2 } = cli.parse('node bin --val abc'.split(' '))
    expect(opts2.val).toBe('abc')
  })

  test('options without schema keep values as strings', () => {
    const cli = goke()

    cli.option('--port <port>', 'Port number')

    // Without schema, mri no longer auto-converts — value stays as string.
    // Use a schema to get typed values.
    const { options } = cli.parse('node bin --port 3000'.split(' '))
    expect(options.port).toBe('3000')
    expect(typeof options.port).toBe('string')
  })

  test('schema with default value', () => {
    const cli = goke()

    cli.option('--port <port>', 'Port number', {
      default: 8080,
      schema: z.number(),
    })

    const { options } = cli.parse('node bin'.split(' '))
    expect(options.port).toBe(8080)
  })

  test('schema on subcommand options', () => {
    const cli = goke()
    let result: any = {}

    cli
      .command('serve', 'Start server')
      .option('--port <port>', 'Port', {
        schema: z.number(),
      })
      .option('--host <host>', 'Host', {
        schema: z.string(),
      })
      .action((options) => {
        result = options
      })

    cli.parse('node bin serve --port 3000 --host localhost'.split(' '), { run: true })
    expect(result.port).toBe(3000)
    expect(result.host).toBe('localhost')
  })
})

describe('no-schema behavior (mri no longer auto-converts)', () => {
  test('numeric string stays as string without schema', () => {
    const cli = goke()
    cli.option('--port <port>', 'Port')
    const { options } = cli.parse('node bin --port 3000'.split(' '))
    expect(options.port).toBe('3000')
  })

  test('leading zeros preserved without schema', () => {
    const cli = goke()
    cli.option('--id <id>', 'ID')
    const { options } = cli.parse('node bin --id 00123'.split(' '))
    expect(options.id).toBe('00123')
  })

  test('phone number preserved without schema', () => {
    const cli = goke()
    cli.option('--phone <phone>', 'Phone')
    const { options } = cli.parse('node bin --phone +1234567890'.split(' '))
    expect(options.phone).toBe('+1234567890')
  })

  test('boolean flags still work without schema', () => {
    const cli = goke()
    cli.option('--verbose', 'Verbose')
    const { options } = cli.parse('node bin --verbose'.split(' '))
    expect(options.verbose).toBe(true)
  })

  test('optional value flag returns true when no value given', () => {
    const cli = goke()
    cli.option('--format [fmt]', 'Format')
    const { options } = cli.parse('node bin --format'.split(' '))
    expect(options.format).toBe(true)
  })

  test('optional value flag returns string when value given', () => {
    const cli = goke()
    cli.option('--format [fmt]', 'Format')
    const { options } = cli.parse('node bin --format json'.split(' '))
    expect(options.format).toBe('json')
  })

  test('hex string stays as string without schema', () => {
    const cli = goke()
    cli.option('--color <color>', 'Color')
    const { options } = cli.parse('node bin --color 0xff00ff'.split(' '))
    expect(options.color).toBe('0xff00ff')
  })

  test('scientific notation stays as string without schema', () => {
    const cli = goke()
    cli.option('--val <val>', 'Value')
    const { options } = cli.parse('node bin --val 1e10'.split(' '))
    expect(options.val).toBe('1e10')
  })
})

describe('typical CLI usage examples', () => {
  test('web server CLI with typed options', () => {
    const cli = goke('myserver')
    let config: any = {}

    cli
      .command('start', 'Start the web server')
      .option('--port <port>', 'Port to listen on', {
        default: 3000,
        schema: z.number(),
      })
      .option('--host <host>', 'Hostname to bind', {
        default: 'localhost',
        schema: z.string(),
      })
      .option('--workers <workers>', 'Number of worker threads', {
        schema: z.int(),
      })
      .option('--cors', 'Enable CORS')
      .option('--log', 'Enable logging')
      .action((options) => { config = options })

    cli.parse('node bin start --port 8080 --host 0.0.0.0 --workers 4 --cors'.split(' '), { run: true })

    expect(config.port).toBe(8080)
    expect(typeof config.port).toBe('number')
    expect(config.host).toBe('0.0.0.0')
    expect(config.workers).toBe(4)
    expect(typeof config.workers).toBe('number')
    expect(config.cors).toBe(true)
  })

  test('web server CLI with defaults (no args)', () => {
    const cli = goke('myserver')
    let config: any = {}

    cli
      .command('start', 'Start the web server')
      .option('--port <port>', 'Port', {
        default: 3000,
        schema: z.number(),
      })
      .option('--host <host>', 'Host', {
        default: 'localhost',
        schema: z.string(),
      })
      .action((options) => { config = options })

    cli.parse('node bin start'.split(' '), { run: true })

    expect(config.port).toBe(3000)
    expect(config.host).toBe('localhost')
  })

  test('database CLI with JSON config option', () => {
    const cli = goke('dbcli')
    let config: any = {}

    cli
      .command('migrate', 'Run database migrations')
      .option('--connection <conn>', 'Connection config (JSON)', {
        schema: z.object({ host: z.string(), port: z.number() }),
      })
      .option('--dry-run', 'Preview without executing')
      .action((options) => { config = options })

    cli.parse(['node', 'bin', 'migrate', '--connection', '{"host":"localhost","port":5432}', '--dry-run'], { run: true })

    expect(config.connection).toEqual({ host: 'localhost', port: 5432 })
    expect(config.dryRun).toBe(true)
  })

  test('file processing CLI with positional args + typed options', () => {
    const cli = goke('fileproc')
    let result: any = {}

    cli
      .command('convert <input> <output>', 'Convert file format')
      .option('--quality <quality>', 'Quality (0-100)', {
        schema: z.int(),
      })
      .option('--format <format>', 'Output format', {
        schema: z.enum(['png', 'jpg', 'webp']),
      })
      .action((input, output, options) => {
        result = { input, output, ...options }
      })

    cli.parse('node bin convert photo.bmp photo.jpg --quality 85 --format jpg'.split(' '), { run: true })

    expect(result.input).toBe('photo.bmp')
    expect(result.output).toBe('photo.jpg')
    expect(result.quality).toBe(85)
    expect(typeof result.quality).toBe('number')
    expect(result.format).toBe('jpg')
  })

  test('API client CLI preserving string IDs', () => {
    const cli = goke('apicli')
    let result: any = {}

    cli
      .command('get-user <userId>', 'Get user by ID')
      .option('--fields <fields>', 'Fields to return (JSON array)', {
        schema: z.array(z.unknown()),
      })
      .action((userId, options) => {
        result = { userId, ...options }
      })

    // userId "00123" should NOT be coerced to number 123
    cli.parse(['node', 'bin', 'get-user', '00123', '--fields', '["name","email"]'], { run: true })

    expect(result.userId).toBe('00123')
    expect(result.fields).toEqual(['name', 'email'])
  })

  test('nullable option with union type', () => {
    const cli = goke()
    cli.option('--timeout <timeout>', 'Timeout', {
      schema: z.nullable(z.number()),
    })

    const { options: opts1 } = cli.parse('node bin --timeout 5000'.split(' '))
    expect(opts1.timeout).toBe(5000)

    // Empty string coerces to null for null type
    const { options: opts2 } = cli.parse(['node', 'bin', '--timeout', ''])
    expect(opts2.timeout).toBe(null)
  })
})

describe('regression: oracle-found issues', () => {
  test('required option with schema still throws when value missing', () => {
    const cli = goke()
    let actionCalled = false

    cli
      .command('serve', 'Start server')
      .option('--port <port>', 'Port', {
        schema: z.number(),
      })
      .action(() => { actionCalled = true })

    // --port without a value should throw "value is missing"
    expect(() => {
      cli.parse('node bin serve --port'.split(' '), { run: true })
    }).toThrow('value is missing')
    expect(actionCalled).toBe(false)
  })

  test('repeated flags with non-array schema throws', () => {
    const cli = goke()

    cli.option('--tag <tag>', 'Tags', {
      schema: z.string(),
    })

    expect(() => cli.parse('node bin --tag foo --tag bar'.split(' ')))
      .toThrow('does not accept multiple values')
  })

  test('repeated flags with number schema throws', () => {
    const cli = goke()

    cli.option('--id <id>', 'ID', {
      schema: z.number(),
    })

    expect(() => cli.parse('node bin --id 1 --id 2'.split(' ')))
      .toThrow('does not accept multiple values')
  })

  test('repeated flags with array schema collects values', () => {
    const cli = goke()

    cli.option('--tag <tag>', 'Tags', {
      schema: z.array(z.string()),
    })

    const { options } = cli.parse('node bin --tag foo --tag bar'.split(' '))
    expect(options.tag).toEqual(['foo', 'bar'])
  })

  test('repeated flags with array+items schema coerces each element', () => {
    const cli = goke()

    cli.option('--id <id>', 'IDs', {
      schema: z.array(z.number()),
    })

    const { options } = cli.parse('node bin --id 1 --id 2 --id 3'.split(' '))
    expect(options.id).toEqual([1, 2, 3])
  })

  test('single value with array schema wraps in array', () => {
    const cli = goke()

    cli.option('--tag <tag>', 'Tags', {
      schema: z.array(z.string()),
    })

    const { options } = cli.parse('node bin --tag foo'.split(' '))
    expect(options.tag).toEqual(['foo'])
  })

  test('single value with array+number items schema wraps and coerces', () => {
    const cli = goke()

    cli.option('--id <id>', 'IDs', {
      schema: z.array(z.number()),
    })

    const { options } = cli.parse('node bin --id 42'.split(' '))
    expect(options.id).toEqual([42])
  })

  test('JSON array string with array schema parses correctly', () => {
    const cli = goke()

    cli.option('--ids <ids>', 'IDs', {
      schema: z.array(z.number()),
    })

    const { options } = cli.parse(['node', 'bin', '--ids', '[1,2,3]'])
    expect(options.ids).toEqual([1, 2, 3])
  })

  test('repeated flags without schema still produce array (no schema = no restriction)', () => {
    const cli = goke()

    cli.option('--tag <tag>', 'Tags')

    const { options } = cli.parse('node bin --tag foo --tag bar'.split(' '))
    expect(options.tag).toEqual(['foo', 'bar'])
  })

  test('const null coercion works', () => {
    expect(coerceBySchema('', { const: null }, 'val')).toBe(null)
  })

  test('optional value option with schema returns undefined when no value given', () => {
    const cli = goke()

    cli.option('--count [count]', 'Count', {
      schema: z.number(),
    })

    // --count without value → schema expects number, none given → undefined
    const { options } = cli.parse('node bin --count'.split(' '))
    expect(options.count).toBe(undefined)
  })

  test('optional value option without schema preserves true sentinel', () => {
    const cli = goke()

    cli.option('--count [count]', 'Count')

    // Without schema, original goke behavior: true means "flag present"
    const { options } = cli.parse('node bin --count'.split(' '))
    expect(options.count).toBe(true)
  })

  test('optional value option with schema coerces when value given', () => {
    const cli = goke()

    cli.option('--count [count]', 'Count', {
      schema: z.number(),
    })

    const { options } = cli.parse('node bin --count 42'.split(' '))
    expect(options.count).toBe(42)
  })

  test('alias + schema coercion works', () => {
    const cli = goke()

    cli.option('-p, --port <port>', 'Port', {
      schema: z.number(),
    })

    const { options } = cli.parse('node bin -p 3000'.split(' '))
    expect(options.port).toBe(3000)
    expect(options.p).toBe(3000)
  })

  test('union type ["array", "null"] with repeated flags', () => {
    const cli = goke()

    cli.option('--tags <tags>', 'Tags', {
      schema: z.nullable(z.array(z.string())),
    })

    const { options } = cli.parse('node bin --tags foo --tags bar'.split(' '))
    expect(options.tags).toEqual(['foo', 'bar'])
  })
})

describe('edge cases: schema + defaults interaction', () => {
  test('default value is preserved as-is, not coerced by schema', () => {
    const cli = goke()

    // default is string "3000" but schema says number — default should stay as-is
    cli.option('--port <port>', 'Port', {
      default: '3000',
      schema: z.number(),
    })

    const { options } = cli.parse('node bin'.split(' '))
    // Is default coerced? This test documents current behavior
    expect(options.port).toBe('3000')
  })

  test('default value is used when option not passed, schema value when passed', () => {
    const cli = goke()

    cli.option('--port <port>', 'Port', {
      default: 8080,
      schema: z.number(),
    })

    const { options: opts1 } = cli.parse('node bin'.split(' '))
    expect(opts1.port).toBe(8080)

    const { options: opts2 } = cli.parse('node bin --port 3000'.split(' '))
    expect(opts2.port).toBe(3000)
  })

  test('optional value + default + schema: three-way interaction', () => {
    const cli = goke()

    cli.option('--count [count]', 'Count', {
      default: 10,
      schema: z.number(),
    })

    // Not passed at all → default
    const { options: opts1 } = cli.parse('node bin'.split(' '))
    expect(opts1.count).toBe(10)

    // Passed with value → coerced
    const { options: opts2 } = cli.parse('node bin --count 42'.split(' '))
    expect(opts2.count).toBe(42)

    // Passed without value → undefined (sentinel replaced)
    const { options: opts3 } = cli.parse('node bin --count'.split(' '))
    expect(opts3.count).toBe(undefined)
  })
})

describe('edge cases: boolean flags + schema', () => {
  test('boolean flag (no brackets) with number schema — mri returns boolean', () => {
    const cli = goke()

    // This is a questionable usage: boolean flag + number schema
    // mri returns true/false for boolean flags, schema tries to coerce boolean→number
    cli.option('--verbose', 'Verbose', {
      schema: z.number(),
    })

    const { options } = cli.parse('node bin --verbose'.split(' '))
    // Boolean true → coerced to 1 by number schema
    expect(options.verbose).toBe(1)
  })

  test('boolean string value with boolean schema on value option', () => {
    const cli = goke()

    cli.option('--flag <flag>', 'A flag', {
      schema: z.boolean(),
    })

    const { options: opts1 } = cli.parse('node bin --flag true'.split(' '))
    expect(opts1.flag).toBe(true)

    const { options: opts2 } = cli.parse('node bin --flag false'.split(' '))
    expect(opts2.flag).toBe(false)
  })

  test('invalid boolean string with boolean schema throws', () => {
    const cli = goke()

    cli.option('--flag <flag>', 'A flag', {
      schema: z.boolean(),
    })

    expect(() => cli.parse('node bin --flag yes'.split(' ')))
      .toThrow('expected true or false')
  })
})

describe('edge cases: dot-nested options + schema', () => {
  test('dot-nested option with number schema coerces value', () => {
    const cli = goke()

    cli.option('--config.port <port>', 'Port', {
      schema: z.number(),
    })

    const { options } = cli.parse('node bin --config.port 3000'.split(' '))
    expect(options.config).toEqual({ port: 3000 })
  })

  test('dot-nested default uses nested object shape', () => {
    const cli = goke()

    cli.option('--config.port <port>', 'Port', {
      default: 8080,
      schema: z.number(),
    })

    const { options } = cli.parse('node bin'.split(' '))
    expect(options.config).toEqual({ port: 8080 })
  })
})

describe('edge cases: kebab-case + schema', () => {
  test('kebab-case option coerced via schema and accessible as camelCase', () => {
    const cli = goke()

    cli.option('--max-retries <count>', 'Max retries', {
      schema: z.number(),
    })

    const { options } = cli.parse('node bin --max-retries 5'.split(' '))
    expect(options.maxRetries).toBe(5)
    expect(typeof options.maxRetries).toBe('number')
  })
})

describe('edge cases: empty string values', () => {
  test('empty string with string schema stays empty string', () => {
    const cli = goke()

    cli.option('--name <name>', 'Name', {
      schema: z.string(),
    })

    const { options } = cli.parse(['node', 'bin', '--name', ''])
    expect(options.name).toBe('')
  })

  test('empty string with number schema throws', () => {
    const cli = goke()

    cli.option('--port <port>', 'Port', {
      schema: z.number(),
    })

    expect(() => cli.parse(['node', 'bin', '--port', '']))
      .toThrow('expected number, got empty string')
  })

  test('empty string with nullable number schema returns null', () => {
    const cli = goke()

    cli.option('--timeout <timeout>', 'Timeout', {
      schema: z.nullable(z.number()),
    })

    const { options } = cli.parse(['node', 'bin', '--timeout', ''])
    expect(options.timeout).toBe(null)
  })
})

describe('edge cases: global options with schema in subcommands', () => {
  test('global option schema applies to subcommand parsing', () => {
    const cli = goke()
    let result: any = {}

    cli.option('--port <port>', 'Port', {
      schema: z.number(),
    })

    cli
      .command('serve', 'Start server')
      .action((options) => { result = options })

    cli.parse('node bin serve --port 3000'.split(' '), { run: true })
    expect(result.port).toBe(3000)
    expect(typeof result.port).toBe('number')
  })
})

describe('edge cases: short alias + schema', () => {
  test('short alias repeated with array schema', () => {
    const cli = goke()

    cli.option('-t, --tag <tag>', 'Tags', {
      schema: z.array(z.string()),
    })

    const { options } = cli.parse('node bin -t foo -t bar'.split(' '))
    expect(options.tag).toEqual(['foo', 'bar'])
    expect(options.t).toEqual(['foo', 'bar'])
  })

  test('short alias single value with array schema wraps', () => {
    const cli = goke()

    cli.option('-t, --tag <tag>', 'Tags', {
      schema: z.array(z.string()),
    })

    const { options } = cli.parse('node bin -t foo'.split(' '))
    expect(options.tag).toEqual(['foo'])
  })

  test('short alias with number schema coerces', () => {
    const cli = goke()

    cli.option('-p, --port <port>', 'Port', {
      schema: z.number(),
    })

    const { options } = cli.parse('node bin -p 8080'.split(' '))
    expect(options.port).toBe(8080)
    expect(options.p).toBe(8080)
  })

  test('short alias repeated with non-array schema throws', () => {
    const cli = goke()

    cli.option('-p, --port <port>', 'Port', {
      schema: z.number(),
    })

    expect(() => cli.parse('node bin -p 3000 -p 4000'.split(' ')))
      .toThrow('does not accept multiple values')
  })
})

test('throw on unknown options', () => {
  const cli = goke()

  cli
    .command('build [entry]', 'Build your app')
    .option('--foo-bar', 'foo bar')
    .option('--aB', 'ab')
    .action(() => {})

  expect(() => {
    cli.parse(`node bin build app.js --fooBar --a-b --xx`.split(' '))
  }).toThrowError('Unknown option `--xx`')
})

describe('space-separated subcommands', () => {
  test('basic subcommand matching', () => {
    const cli = goke()
    let matched = ''

    cli.command('mcp login', 'Login to MCP').action(() => {
      matched = 'mcp login'
    })

    cli.parse(['node', 'bin', 'mcp', 'login'], { run: true })
    expect(matched).toBe('mcp login')
    expect(cli.matchedCommandName).toBe('mcp login')
  })

  test('subcommand with positional args', () => {
    const cli = goke()
    let receivedId = ''

    cli.command('mcp getNodeXml <id>', 'Get XML for a node').action((id) => {
      receivedId = id
    })

    cli.parse(['node', 'bin', 'mcp', 'getNodeXml', '123'], { run: true })
    expect(receivedId).toBe('123')
    expect(cli.matchedCommandName).toBe('mcp getNodeXml')
  })

  test('subcommand with options', () => {
    const cli = goke()
    let result: any = {}

    cli
      .command('mcp export <id>', 'Export something')
      .option('--format <format>', 'Output format')
      .action((id, options) => {
        result = { id, format: options.format }
      })

    cli.parse(['node', 'bin', 'mcp', 'export', 'abc', '--format', 'json'], {
      run: true,
    })
    expect(result).toEqual({ id: 'abc', format: 'json' })
  })

  test('greedy matching - longer commands match first', () => {
    const cli = goke()
    let matched = ''

    cli.command('mcp', 'MCP base command').action(() => {
      matched = 'mcp'
    })

    cli.command('mcp login', 'Login to MCP').action(() => {
      matched = 'mcp login'
    })

    cli.parse(['node', 'bin', 'mcp', 'login'], { run: true })
    expect(matched).toBe('mcp login')
  })

  test('three-level subcommand', () => {
    const cli = goke()
    let matched = ''

    cli.command('git remote add', 'Add a remote').action(() => {
      matched = 'git remote add'
    })

    cli.parse(['node', 'bin', 'git', 'remote', 'add'], { run: true })
    expect(matched).toBe('git remote add')
    expect(cli.matchedCommandName).toBe('git remote add')
  })

  test('single-word commands still work (backward compatibility)', () => {
    const cli = goke()
    let matched = ''

    cli.command('build', 'Build the project').action(() => {
      matched = 'build'
    })

    cli.parse(['node', 'bin', 'build'], { run: true })
    expect(matched).toBe('build')
    expect(cli.matchedCommandName).toBe('build')
  })

  test('subcommand does not match when args are insufficient', () => {
    const cli = goke()
    let matched = ''

    cli.command('mcp login', 'Login to MCP').action(() => {
      matched = 'mcp login'
    })

    cli.command('mcp', 'MCP base').action(() => {
      matched = 'mcp base'
    })

    cli.parse(['node', 'bin', 'mcp'], { run: true })
    expect(matched).toBe('mcp base')
  })

  test('default command should not match if args are prefix of another command', () => {
    const cli = goke()
    let matched = ''

    cli.command('mcp login', 'Login to MCP').action(() => {
      matched = 'mcp login'
    })

    cli.command('', 'Default command').action(() => {
      matched = 'default'
    })

    cli.parse(['node', 'bin', 'mcp'], { run: true })
    expect(matched).toBe('')
    expect(cli.matchedCommand).toBeUndefined()
  })

  test('default command should match when args do not prefix any command', () => {
    const cli = goke()
    let matched = ''
    let receivedArg = ''

    cli.command('mcp login', 'Login to MCP').action(() => {
      matched = 'mcp login'
    })

    cli.command('<file>', 'Default command').action((file) => {
      matched = 'default'
      receivedArg = file
    })

    cli.parse(['node', 'bin', 'foo'], { run: true })
    expect(matched).toBe('default')
    expect(receivedArg).toBe('foo')
  })

  test('help output with subcommands', () => {
    const cli = goke('mycli')

    cli.command('mcp login <url>', 'Login to MCP server')
    cli.command('mcp logout', 'Logout from MCP server')
    cli.command('mcp status', 'Show connection status')
    cli.command('git remote add <name> <url>', 'Add a git remote')
    cli.command('git remote remove <name>', 'Remove a git remote')
    cli.command('build', 'Build the project').option('--watch', 'Watch mode')

    cli.help()
    cli.parse(['node', 'bin', '--help'], { run: false })

    let output = ''
    const originalLog = console.log
    console.log = (msg: string) => {
      output += msg + '\n'
    }
    cli.outputHelp()
    console.log = originalLog

    expect(output).toMatchInlineSnapshot(`
      "mycli

      Usage:
        $ mycli <command> [options]

      Commands:
        mcp login <url>              Login to MCP server
        mcp logout                   Logout from MCP server
        mcp status                   Show connection status
        git remote add <name> <url>  Add a git remote
        git remote remove <name>     Remove a git remote
        build                        Build the project

      For more info, run any command with the \`--help\` flag:
        $ mycli mcp login --help
        $ mycli mcp logout --help
        $ mycli mcp status --help
        $ mycli git remote add --help
        $ mycli git remote remove --help
        $ mycli build --help

      Options:
        -h, --help  Display this message 
      "
    `)
  })

  test('unknown subcommand shows filtered help for prefix', () => {
    const cli = goke('mycli')

    cli.command('mcp login', 'Login to MCP')
    cli.command('mcp logout', 'Logout from MCP')
    cli.command('mcp status', 'Show status')
    cli.command('build', 'Build project')

    cli.help()

    let output = ''
    const originalLog = console.log
    console.log = (msg: string) => {
      output += msg + '\n'
    }

    // User types "mcp nonexistent" - should show help for mcp commands
    cli.parse(['node', 'bin', 'mcp', 'nonexistent'], { run: true })

    console.log = originalLog

    expect(cli.matchedCommand).toBeUndefined()
    expect(output).toContain('Unknown command: mcp nonexistent')
    expect(output).toContain('Available "mcp" commands:')
    expect(output).toContain('mcp login')
    expect(output).toContain('mcp logout')
    expect(output).toContain('mcp status')
    expect(output).not.toContain('build')
  })

  test('unknown command without prefix does not show filtered help', () => {
    const cli = goke('mycli')

    cli.command('mcp login', 'Login to MCP')
    cli.command('build', 'Build project')

    cli.help()

    let output = ''
    const originalLog = console.log
    console.log = (msg: string) => {
      output += msg + '\n'
    }

    // User types "foo" - no commands start with "foo"
    cli.parse(['node', 'bin', 'foo'], { run: true })

    console.log = originalLog

    // Should not show filtered help since "foo" is not a prefix of any command
    expect(output).not.toContain('Available "foo" commands')
  })
})
