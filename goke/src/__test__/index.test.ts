import { describe, test, expect } from 'vitest'
import goke, { createConsole } from '../index.js'
import type { GokeOutputStream, GokeOptions } from '../index.js'
import { coerceBySchema } from '../coerce.js'
import { z } from 'zod'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ANSI_RE = /\x1B\[[0-9;]*m/g

const stripAnsi = (text: string) => text.replace(ANSI_RE, '')

/**
 * Helper: creates a GokeOutputStream that captures all written data into a string array.
 * Access `output.lines` for raw writes, or `output.text` for the joined result.
 */
function createTestOutputStream(): GokeOutputStream & { lines: string[]; readonly text: string } {
  const lines: string[] = []
  return {
    lines,
    get text() { return stripAnsi(lines.join('')) },
    write(data: string) { lines.push(data) },
  }
}

/**
 * Helper: creates a goke instance with exit overridden to a no-op.
 * This prevents process.exit(1) from killing the test runner while
 * still allowing the original error to propagate (the framework
 * re-throws after calling exit when exit doesn't halt execution).
 *
 * Tests can still use .toThrow() to assert CLI errors normally.
 */
function gokeTestable(name = '', options?: Partial<GokeOptions>) {
  return goke(name, {
    ...options,
    exit: () => {},
  })
}

/**
 * Strip stack trace lines for stable snapshots.
 * Keeps the error message and help hint, removes all "    at ..." lines
 * and the blank line before them, since those contain machine-specific paths.
 */
function stripStackTrace(text: string): string {
  return text
    .split('\n')
    .filter(line => !line.match(/^\s+at /))
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

describe('error formatting', () => {
  test('unknown option prints formatted error to stderr', async () => {
    const stderr = createTestOutputStream()
    const cli = goke('mycli', { stderr, exit: () => {} })

    cli
      .command('build', 'Build your app')
      .option('--port <port>', 'Port')
      .action(() => {})

    try {
      await cli.parse('node bin build --unknown'.split(' '))
    } catch {}

    expect(stripStackTrace(stderr.text)).toMatchInlineSnapshot(`"error: Unknown option \`--unknown\`"`)
  })

  test('missing required option value prints formatted error to stderr', async () => {
    const stderr = createTestOutputStream()
    const cli = goke('mycli', { stderr, exit: () => {} })

    cli
      .command('serve', 'Start server')
      .option('--port <port>', 'Port')
      .action(() => {})

    try {
      await cli.parse('node bin serve --port'.split(' '))
    } catch {}

    expect(stripStackTrace(stderr.text)).toMatchInlineSnapshot(`"error: option \`--port <port>\` value is missing"`)
  })

  test('schema coercion error prints formatted error to stderr', async () => {
    const stderr = createTestOutputStream()
    const cli = goke('mycli', { stderr, exit: () => {} })

    cli.option('--port <port>', z.number().describe('Port'))

    try {
      await cli.parse('node bin --port abc'.split(' '))
    } catch {}

    expect(stripStackTrace(stderr.text)).toMatchInlineSnapshot(`"error: Invalid value for --port: expected number, got "abc""`)
  })

  test('error includes help hint when help is enabled', async () => {
    const stderr = createTestOutputStream()
    const cli = goke('mycli', { stderr, exit: () => {} })

    cli.help()

    cli
      .command('serve', 'Start server')
      .option('--port <port>', 'Port')
      .action(() => {})

    try {
      await cli.parse('node bin serve --port'.split(' '))
    } catch {}

    expect(stripStackTrace(stderr.text)).toMatchInlineSnapshot(`
      "error: option \`--port <port>\` value is missing
      Run "mycli serve --help" for usage information."
    `)
  })

  test('async action error prints formatted error to stderr', async () => {
    const stderr = createTestOutputStream()
    let exitCode: number | undefined
    const cli = goke('mycli', { stderr, exit: (code) => { exitCode = code } })

    cli
      .command('deploy', 'Deploy app')
      .action(async () => {
        throw new Error('connection refused')
      })

    await cli.parse('node bin deploy'.split(' '))

    // Wait for the async rejection to be handled
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(exitCode).toBe(1)
    expect(stripStackTrace(stderr.text)).toMatchInlineSnapshot(`"error: connection refused"`)
  })

  test('GokeError (validation) omits stack trace', async () => {
    const stderr = createTestOutputStream()
    const cli = goke('mycli', { stderr, exit: () => {} })

    cli
      .command('build', 'Build app')
      .action(() => {})

    try {
      await cli.parse('node bin build --unknown'.split(' '))
    } catch {}

    const text = stderr.text
    expect(text).toContain('error:')
    expect(text).toContain('Unknown option `--unknown`')
    // GokeError is a user-facing error; stack trace should be suppressed
    expect(text).not.toMatch(/at /)
  })

  test('unexpected error still includes stack trace', async () => {
    const stderr = createTestOutputStream()
    const cli = goke('mycli', { stderr, exit: () => {} })

    cli
      .command('deploy', 'Deploy app')
      .action(async () => {
        throw new Error('unexpected crash')
      })

    await cli.parse('node bin deploy'.split(' '))
    await new Promise(resolve => setTimeout(resolve, 10))

    const text = stderr.text
    expect(text).toContain('error:')
    expect(text).toContain('unexpected crash')
    // Non-GokeError should still show the stack trace
    expect(text).toMatch(/at /)
  })
})

describe('anonymous action naming', () => {
  test('inline anonymous function gets named after the command', async () => {
    const cli = gokeTestable('mycli')
    const cmd = cli.command('deploy', 'Deploy app')
    // Inline arrow functions passed directly to .action() have no name,
    // so goke assigns one based on the command name for better stack traces.
    cmd.action(() => {})
    expect(cmd.commandAction!.name).toBe('command:deploy')
  })

  test('inline anonymous function on multi-word command gets full name', async () => {
    const cli = gokeTestable('mycli')
    const cmd = cli.command('db migrate', 'Run migrations')
    cmd.action(() => {})
    expect(cmd.commandAction!.name).toBe('command:db migrate')
  })

  test('named function keeps its original name', async () => {
    const cli = gokeTestable('mycli')
    const cmd = cli.command('build', 'Build app')
    function myBuildAction() {}
    cmd.action(myBuildAction)
    expect(cmd.commandAction!.name).toBe('myBuildAction')
  })

  test('default command action gets "command:default" name', async () => {
    const cli = gokeTestable('mycli')
    const cmd = cli.command('', 'Default command')
    cmd.action(() => {})
    expect(cmd.commandAction!.name).toBe('command:default')
  })
})

describe('injected fs', () => {
  test('parse waits for async command actions before resolving', async () => {
    const stdout = createTestOutputStream()
    const cli = gokeTestable('mycli', { stdout })

    cli
      .command('deploy', 'Deploy app')
      .action(async (options, { console }) => {
        await new Promise(resolve => setTimeout(resolve, 10))
        console.log('deploy complete')
      })

    await cli.parse(['node', 'bin', 'deploy'])

    expect(stdout.text).toBe('deploy complete\n')
  })

  test('command actions can use the default node fs for cli storage', async () => {
    const stdout = createTestOutputStream()
    const cli = gokeTestable('mycli', { stdout })
    const originalCwd = process.cwd()
    const tempDir = await mkdtemp(join(tmpdir(), 'goke-fs-'))

    try {
      process.chdir(tempDir)

      cli
        .command('login', 'Persist login state')
        .option('--token <token>', z.string().describe('Token'))
        .action(async (options, { fs, console }) => {
          await fs.mkdir('.mycli', { recursive: true })
          await fs.writeFile('.mycli/auth.json', JSON.stringify({ token: options.token }), 'utf8')
          console.log('saved credentials')
        })

      await cli.parse(['node', 'bin', 'login', '--token', 'abc123'], { run: false })
      await cli.runMatchedCommand()

      expect(stdout.text).toBe('saved credentials\n')
      expect(await readFile(join(tempDir, '.mycli/auth.json'), 'utf8')).toBe('{"token":"abc123"}')
    } finally {
      process.chdir(originalCwd)
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

describe('injected process context', () => {
  test('command actions receive host cwd, env, and stdin defaults', async () => {
    const stdout = createTestOutputStream()
    const cli = gokeTestable('mycli', { stdout })
    const originalCwd = process.cwd()
    const originalEnv = process.env.GOKE_TEST_TOKEN
    const tempDir = await mkdtemp(join(tmpdir(), 'goke-process-'))

    try {
      process.chdir(tempDir)
      process.env.GOKE_TEST_TOKEN = 'abc123'

      cli
        .command('context', 'Inspect process context')
        .action((options, { console, process }) => {
          console.log(JSON.stringify({
            cwd: process.cwd,
            stdin: process.stdin,
            token: process.env.GOKE_TEST_TOKEN,
          }))
        })

      await cli.parse(['node', 'bin', 'context'], { run: false })
      await cli.runMatchedCommand()

      expect(stdout.text).toBe(
        `${JSON.stringify({ cwd: process.cwd(), stdin: '', token: 'abc123' })}\n`,
      )
    } finally {
      process.chdir(originalCwd)
      if (originalEnv === undefined) {
        delete process.env.GOKE_TEST_TOKEN
      } else {
        process.env.GOKE_TEST_TOKEN = originalEnv
      }
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test('custom injected env stays mutable inside command actions', async () => {
    const stdout = createTestOutputStream()
    const env: Record<string, string | undefined> = { TOKEN: 'before' }
    const cli = gokeTestable('mycli', { env, stdout })

    cli
      .command('context', 'Mutate process env')
      .action((options, { console, process }) => {
        process.env.TOKEN = 'after'
        console.log(process.env.TOKEN)
      })

    await cli.parse(['node', 'bin', 'context'], { run: false })
    await cli.runMatchedCommand()

    expect(stdout.text).toBe('after\n')
    expect(env.TOKEN).toBe('after')
  })
})

test('double dashes', async () => {
  const cli = goke()

  const { args, options } = await cli.parse([
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

test('dot-nested options', async () => {
  const cli = goke()

  cli
    .option('--externals <external>', 'Add externals')
    .option('--scale [level]', 'Scaling level')

  const { options: options1 } = await cli.parse(
    `node bin --externals.env.prod production --scale`.split(' ')
  )
  expect(options1.externals).toEqual({ env: { prod: 'production' } })
  // Bare `--scale` normalizes to `''` (new uniform string-or-undefined shape
  // for untyped optional-value flags).
  expect(options1.scale).toEqual('')
})

describe('schema-based options', () => {
  test('schema coerces string to number', async () => {
    const cli = goke()

    cli.option('--port <port>', z.number().describe('Port number'))

    const { options } = await cli.parse('node bin --port 3000'.split(' '))
    expect(options.port).toBe(3000)
    expect(typeof options.port).toBe('number')
  })

  test('schema preserves string (no auto-conversion to number)', async () => {
    const cli = goke()

    cli.option('--id <id>', z.string().describe('ID'))

    const { options } = await cli.parse('node bin --id 00123'.split(' '))
    expect(options.id).toBe('00123')
    expect(typeof options.id).toBe('string')
  })

  test('schema coerces string to integer', async () => {
    const cli = goke()

    cli.option('--count <count>', z.int().describe('Count'))

    const { options } = await cli.parse('node bin --count 42'.split(' '))
    expect(options.count).toBe(42)
  })

  test('schema parses JSON object', async () => {
    const cli = goke()

    cli.option('--config <config>', z.looseObject({}).describe('Config'))

    const { options } = await cli.parse(['node', 'bin', '--config', '{"a":1}'])
    expect(options.config).toEqual({ a: 1 })
  })

  test('schema parses JSON array', async () => {
    const cli = goke()

    cli.option('--items <items>', z.array(z.unknown()).describe('Items'))

    const { options } = await cli.parse(['node', 'bin', '--items', '[1,2,3]'])
    expect(options.items).toEqual([1, 2, 3])
  })

  test('schema throws on invalid number', async () => {
    const cli = gokeTestable()

    cli.option('--port <port>', z.number().describe('Port number'))

    await expect(cli.parse('node bin --port abc'.split(' ')))
      .rejects.toThrow('expected number, got "abc"')
  })

  test('schema with union type ["number", "string"]', async () => {
    const cli = goke()

    cli.option('--val <val>', z.union([z.number(), z.string()]).describe('Value'))

    const { options: opts1 } = await cli.parse('node bin --val 123'.split(' '))
    expect(opts1.val).toBe(123)

    const { options: opts2 } = await cli.parse('node bin --val abc'.split(' '))
    expect(opts2.val).toBe('abc')
  })

  test('options without schema keep values as strings', async () => {
    const cli = goke()

    cli.option('--port <port>', 'Port number')

    // Without schema, mri no longer auto-converts — value stays as string.
    // Use a schema to get typed values.
    const { options } = await cli.parse('node bin --port 3000'.split(' '))
    expect(options.port).toBe('3000')
    expect(typeof options.port).toBe('string')
  })

  test('schema with default value', async () => {
    const cli = goke()

    cli.option('--port [port]', z.number().default(8080).describe('Port number'))

    const { options } = await cli.parse('node bin'.split(' '))
    expect(options.port).toBe(8080)
  })

  test('schema on subcommand options', async () => {
    const cli = goke()
    let result: any = {}

    cli
      .command('serve', 'Start server')
      .option('--port <port>', z.number().describe('Port'))
      .option('--host <host>', z.string().describe('Host'))
      .action((options) => {
        result = options
      })

    await cli.parse('node bin serve --port 3000 --host localhost'.split(' '), { run: true })
    expect(result.port).toBe(3000)
    expect(result.host).toBe('localhost')
  })
})

describe('no-schema behavior (mri no longer auto-converts)', () => {
  test('numeric string stays as string without schema', async () => {
    const cli = goke()
    cli.option('--port <port>', 'Port')
    const { options } = await cli.parse('node bin --port 3000'.split(' '))
    expect(options.port).toBe('3000')
  })

  test('leading zeros preserved without schema', async () => {
    const cli = goke()
    cli.option('--id <id>', 'ID')
    const { options } = await cli.parse('node bin --id 00123'.split(' '))
    expect(options.id).toBe('00123')
  })

  test('phone number preserved without schema', async () => {
    const cli = goke()
    cli.option('--phone <phone>', 'Phone')
    const { options } = await cli.parse('node bin --phone +1234567890'.split(' '))
    expect(options.phone).toBe('+1234567890')
  })

  test('boolean flags still work without schema', async () => {
    const cli = goke()
    cli.option('--verbose', 'Verbose')
    const { options } = await cli.parse('node bin --verbose'.split(' '))
    expect(options.verbose).toBe(true)
  })

  test('optional value flag returns empty string when no value given', async () => {
    // Bare `--format` is normalized from the mri `true` sentinel to `''` so
    // callers see a uniform `string | undefined` shape. `''` still lets them
    // distinguish "flag present but no value" from "flag omitted entirely".
    const cli = goke()
    cli.option('--format [fmt]', 'Format')
    const { options } = await cli.parse('node bin --format'.split(' '))
    expect(options.format).toBe('')
  })

  test('optional value flag returns string when value given', async () => {
    const cli = goke()
    cli.option('--format [fmt]', 'Format')
    const { options } = await cli.parse('node bin --format json'.split(' '))
    expect(options.format).toBe('json')
  })

  test('hex string stays as string without schema', async () => {
    const cli = goke()
    cli.option('--color <color>', 'Color')
    const { options } = await cli.parse('node bin --color 0xff00ff'.split(' '))
    expect(options.color).toBe('0xff00ff')
  })

  test('scientific notation stays as string without schema', async () => {
    const cli = goke()
    cli.option('--val <val>', 'Value')
    const { options } = await cli.parse('node bin --val 1e10'.split(' '))
    expect(options.val).toBe('1e10')
  })
})

describe('typical CLI usage examples', () => {
  test('web server CLI with typed options', async () => {
    const cli = goke('myserver')
    let config: any = {}

    cli
      .command('start', 'Start the web server')
      .option('--port <port>', z.number().default(3000).describe('Port to listen on'))
      .option('--host <host>', z.string().default('localhost').describe('Hostname to bind'))
      .option('--workers <workers>', z.int().describe('Number of worker threads'))
      .option('--cors', 'Enable CORS')
      .option('--log', 'Enable logging')
      .action((options) => { config = options })

    await cli.parse('node bin start --port 8080 --host 0.0.0.0 --workers 4 --cors'.split(' '), { run: true })

    expect(config.port).toBe(8080)
    expect(typeof config.port).toBe('number')
    expect(config.host).toBe('0.0.0.0')
    expect(config.workers).toBe(4)
    expect(typeof config.workers).toBe('number')
    expect(config.cors).toBe(true)
  })

  test('web server CLI with defaults (no args)', async () => {
    const cli = goke('myserver')
    let config: any = {}

    cli
      .command('start', 'Start the web server')
      .option('--port [port]', z.number().default(3000).describe('Port'))
      .option('--host [host]', z.string().default('localhost').describe('Host'))
      .action((options) => { config = options })

    await cli.parse('node bin start'.split(' '), { run: true })

    expect(config.port).toBe(3000)
    expect(config.host).toBe('localhost')
  })

  test('database CLI with JSON config option', async () => {
    const cli = goke('dbcli')
    let config: any = {}

    cli
      .command('migrate', 'Run database migrations')
      .option('--connection <conn>', z.object({ host: z.string(), port: z.number() }).describe('Connection config (JSON)'))
      .option('--dry-run', 'Preview without executing')
      .action((options) => { config = options })

    await cli.parse(['node', 'bin', 'migrate', '--connection', '{"host":"localhost","port":5432}', '--dry-run'], { run: true })

    expect(config.connection).toEqual({ host: 'localhost', port: 5432 })
    expect(config.dryRun).toBe(true)
  })

  test('file processing CLI with positional args + typed options', async () => {
    const cli = goke('fileproc')
    let result: any = {}

    cli
      .command('convert <input> <output>', 'Convert file format')
      .option('--quality <quality>', z.int().describe('Quality (0-100)'))
      .option('--format <format>', z.enum(['png', 'jpg', 'webp']).describe('Output format'))
      .action((input, output, options) => {
        result = { input, output, ...options }
      })

    await cli.parse('node bin convert photo.bmp photo.jpg --quality 85 --format jpg'.split(' '), { run: true })

    expect(result.input).toBe('photo.bmp')
    expect(result.output).toBe('photo.jpg')
    expect(result.quality).toBe(85)
    expect(typeof result.quality).toBe('number')
    expect(result.format).toBe('jpg')
  })

  test('API client CLI preserving string IDs', async () => {
    const cli = goke('apicli')
    let result: any = {}

    cli
      .command('get-user <userId>', 'Get user by ID')
      .option('--fields <fields>', z.array(z.unknown()).describe('Fields to return (JSON array)'))
      .action((userId, options) => {
        result = { userId, ...options }
      })

    // userId "00123" should NOT be coerced to number 123
    await cli.parse(['node', 'bin', 'get-user', '00123', '--fields', '["name","email"]'], { run: true })

    expect(result.userId).toBe('00123')
    expect(result.fields).toEqual(['name', 'email'])
  })

  test('nullable option with union type', async () => {
    const cli = goke()
    cli.option('--timeout <timeout>', z.nullable(z.number()).describe('Timeout'))

    const { options: opts1 } = await cli.parse('node bin --timeout 5000'.split(' '))
    expect(opts1.timeout).toBe(5000)

    // Empty string coerces to null for null type
    const { options: opts2 } = await cli.parse(['node', 'bin', '--timeout', ''])
    expect(opts2.timeout).toBe(null)
  })
})

describe('regression: oracle-found issues', () => {
  test('required option with schema still throws when value missing', async () => {
    const cli = gokeTestable()
    let actionCalled = false

    cli
      .command('serve', 'Start server')
      .option('--port <port>', z.number().describe('Port'))
      .action(() => { actionCalled = true })

    // --port without a value should throw "value is missing"
    await expect(cli.parse('node bin serve --port'.split(' '), { run: true }))
      .rejects.toThrow('value is missing')
    expect(actionCalled).toBe(false)
  })

  test('repeated flags with non-array schema throws', async () => {
    const cli = gokeTestable()

    cli.option('--tag <tag>', z.string().describe('Tags'))

    await expect(cli.parse('node bin --tag foo --tag bar'.split(' ')))
      .rejects.toThrow('does not accept multiple values')
  })

  test('repeated flags with number schema throws', async () => {
    const cli = gokeTestable()

    cli.option('--id <id>', z.number().describe('ID'))

    await expect(cli.parse('node bin --id 1 --id 2'.split(' ')))
      .rejects.toThrow('does not accept multiple values')
  })

  test('repeated flags with array schema collects values', async () => {
    const cli = goke()

    cli.option('--tag <tag>', z.array(z.string()).describe('Tags'))

    const { options } = await cli.parse('node bin --tag foo --tag bar'.split(' '))
    expect(options.tag).toEqual(['foo', 'bar'])
  })

  test('repeated flags with array+items schema coerces each element', async () => {
    const cli = goke()

    cli.option('--id <id>', z.array(z.number()).describe('IDs'))

    const { options } = await cli.parse('node bin --id 1 --id 2 --id 3'.split(' '))
    expect(options.id).toEqual([1, 2, 3])
  })

  test('single value with array schema wraps in array', async () => {
    const cli = goke()

    cli.option('--tag <tag>', z.array(z.string()).describe('Tags'))

    const { options } = await cli.parse('node bin --tag foo'.split(' '))
    expect(options.tag).toEqual(['foo'])
  })

  test('single value with array+number items schema wraps and coerces', async () => {
    const cli = goke()

    cli.option('--id <id>', z.array(z.number()).describe('IDs'))

    const { options } = await cli.parse('node bin --id 42'.split(' '))
    expect(options.id).toEqual([42])
  })

  test('JSON array string with array schema parses correctly', async () => {
    const cli = goke()

    cli.option('--ids <ids>', z.array(z.number()).describe('IDs'))

    const { options } = await cli.parse(['node', 'bin', '--ids', '[1,2,3]'])
    expect(options.ids).toEqual([1, 2, 3])
  })

  test('repeated flags without schema still produce array (no schema = no restriction)', async () => {
    const cli = goke()

    cli.option('--tag <tag>', 'Tags')

    const { options } = await cli.parse('node bin --tag foo --tag bar'.split(' '))
    expect(options.tag).toEqual(['foo', 'bar'])
  })

  test('repeated optional value option without schema produces array', async () => {
    const cli = goke()

    cli.option('--tag [tag]', 'Tags')

    const { options } = await cli.parse('node bin --tag foo --tag bar'.split(' '))
    expect(options.tag).toEqual(['foo', 'bar'])
  })

  test('repeated alias option without schema produces array', async () => {
    const cli = goke()

    cli.option('-t, --tag <tag>', 'Tags')

    const { options } = await cli.parse('node bin -t foo -t bar -t baz'.split(' '))
    expect(options.tag).toEqual(['foo', 'bar', 'baz'])
    expect(options.t).toEqual(['foo', 'bar', 'baz'])
  })

  test('repeated option without schema on subcommand produces array', async () => {
    const cli = goke()
    let result: any = {}

    cli
      .command('build', 'Build')
      .option('--exclude <path>', 'Paths to exclude')
      .action((options) => { result = options })

    await cli.parse('node bin build --exclude node_modules --exclude dist --exclude .git'.split(' '), { run: true })
    expect(result.exclude).toEqual(['node_modules', 'dist', '.git'])
  })

  test('single value without schema stays as string (not wrapped in array)', async () => {
    const cli = goke()

    cli.option('--tag <tag>', 'Tags')

    const { options } = await cli.parse('node bin --tag foo'.split(' '))
    expect(options.tag).toBe('foo')
  })

  test('const null coercion works', async () => {
    expect(coerceBySchema('', { const: null }, 'val')).toBe(null)
  })

  test('optional value option with schema returns undefined when no value given', async () => {
    const cli = goke()

    cli.option('--count [count]', z.number().describe('Count'))

    // --count without value → schema expects number, none given → undefined
    const { options } = await cli.parse('node bin --count'.split(' '))
    expect(options.count).toBe(undefined)
  })

  test('optional value option without schema normalizes bare flag to empty string', async () => {
    const cli = goke()

    cli.option('--count [count]', 'Count')

    // Untyped optional-value flags uniformly expose `string | undefined`:
    //   - `--count`       → ''          (flag present, no value)
    //   - `--count 42`    → '42'        (flag present, with value)
    //   - (omitted)       → undefined   (flag absent)
    // This lets callers use a single `typeof options.count === 'string'`
    // check and distinguish the three cases via `=== ''` if they need to.
    const { options } = await cli.parse('node bin --count'.split(' '))
    expect(options.count).toBe('')
  })

  test('optional value option with schema coerces when value given', async () => {
    const cli = goke()

    cli.option('--count [count]', z.number().describe('Count'))

    const { options } = await cli.parse('node bin --count 42'.split(' '))
    expect(options.count).toBe(42)
  })

  test('optional value option with schema default returns default when omitted', async () => {
    // `z.number().default(30)` has input `number | undefined` → output `number`,
    // so goke marks this option as effectively required and must surface the
    // default value at runtime when the flag is omitted.
    const cli = goke()
    cli.option('--limit [n]', z.number().default(30).describe('Max items'))

    const { options } = await cli.parse('node bin'.split(' '))
    expect(options.limit).toBe(30)
  })

  test('optional value option with schema default returns default when passed bare', async () => {
    // Bare `--limit` is mri's "flag present, no value" sentinel. Without a
    // default, goke replaces it with `undefined`. With a default, goke must
    // preserve the preset default value instead of clobbering it, so the
    // type-level `HasSchemaDefault` promise ("property is required at runtime")
    // holds for all three input states: omitted, bare, and with-value.
    const cli = goke()
    cli.option('--limit [n]', z.number().default(30).describe('Max items'))

    const { options } = await cli.parse('node bin --limit'.split(' '))
    expect(options.limit).toBe(30)
  })

  test('optional value option with schema default coerces explicit value', async () => {
    const cli = goke()
    cli.option('--limit [n]', z.number().default(30).describe('Max items'))

    const { options } = await cli.parse('node bin --limit 5'.split(' '))
    expect(options.limit).toBe(5)
  })

  test('multiple optional options with defaults all preserve their defaults', async () => {
    // Regression test for the runtime-overwrite bug: when several schema-backed
    // optional flags have defaults, passing one bare should not clobber the
    // others, and the bare one should keep its own default.
    const cli = goke()
    cli
      .option('--limit [n]', z.number().default(30))
      .option('--sort [mode]', z.enum(['asc', 'desc']).default('asc'))
      .option('--host [host]', z.string().default('localhost'))

    const { options } = await cli.parse('node bin --sort'.split(' '))
    expect(options.limit).toBe(30)
    expect(options.sort).toBe('asc')
    expect(options.host).toBe('localhost')
  })

  test('alias + schema coercion works', async () => {
    const cli = goke()

    cli.option('-p, --port <port>', z.number().describe('Port'))

    const { options } = await cli.parse('node bin -p 3000'.split(' '))
    expect(options.port).toBe(3000)
    expect(options.p).toBe(3000)
  })

  test('union type ["array", "null"] with repeated flags', async () => {
    const cli = goke()

    cli.option('--tags <tags>', z.nullable(z.array(z.string())).describe('Tags'))

    const { options } = await cli.parse('node bin --tags foo --tags bar'.split(' '))
    expect(options.tags).toEqual(['foo', 'bar'])
  })
})

describe('edge cases: schema + defaults interaction', () => {
  test('default value from schema is used when option not passed', async () => {
    const cli = goke()

    cli.option('--port [port]', z.number().default(8080).describe('Port'))

    const { options } = await cli.parse('node bin'.split(' '))
    expect(options.port).toBe(8080)
  })

  test('default value is used when option not passed, schema value when passed', async () => {
    const cli = goke()

    cli.option('--port [port]', z.number().default(8080).describe('Port'))

    const { options: opts1 } = await cli.parse('node bin'.split(' '))
    expect(opts1.port).toBe(8080)

    const { options: opts2 } = await cli.parse('node bin --port 3000'.split(' '))
    expect(opts2.port).toBe(3000)
  })

  test('optional value + default + schema: three-way interaction', async () => {
    const cli = goke()

    cli.option('--count [count]', z.number().default(10).describe('Count'))

    // Not passed at all → default
    const { options: opts1 } = await cli.parse('node bin'.split(' '))
    expect(opts1.count).toBe(10)

    // Passed with value → coerced
    const { options: opts2 } = await cli.parse('node bin --count 42'.split(' '))
    expect(opts2.count).toBe(42)

    // Passed without value → default preserved. Before goke 6.7.0 this test
    // expected `undefined` because the bare-flag sentinel overwrote the
    // preset default. With the HasSchemaDefault type inference, the runtime
    // must keep the default so that the type-level promise ("options.count
    // is always a number") holds for all three input states.
    const { options: opts3 } = await cli.parse('node bin --count'.split(' '))
    expect(opts3.count).toBe(10)
  })
})

describe('edge cases: boolean flags + schema', () => {
  test('boolean flag (no brackets) with number schema — mri returns boolean', async () => {
    const cli = goke()

    // This is a questionable usage: boolean flag + number schema
    // mri returns true/false for boolean flags, schema tries to coerce boolean→number
    cli.option('--verbose', z.number().describe('Verbose'))

    const { options } = await cli.parse('node bin --verbose'.split(' '))
    // Boolean true → coerced to 1 by number schema
    expect(options.verbose).toBe(1)
  })

  test('boolean string value with boolean schema on value option', async () => {
    const cli = goke()

    cli.option('--flag <flag>', z.boolean().describe('A flag'))

    const { options: opts1 } = await cli.parse('node bin --flag true'.split(' '))
    expect(opts1.flag).toBe(true)

    const { options: opts2 } = await cli.parse('node bin --flag false'.split(' '))
    expect(opts2.flag).toBe(false)
  })

  test('invalid boolean string with boolean schema throws', async () => {
    const cli = gokeTestable()

    cli.option('--flag <flag>', z.boolean().describe('A flag'))

    await expect(cli.parse('node bin --flag yes'.split(' ')))
      .rejects.toThrow('expected true or false')
  })
})

describe('edge cases: dot-nested options + schema', () => {
  test('dot-nested option with number schema coerces value', async () => {
    const cli = goke()

    cli.option('--config.port <port>', z.number().describe('Port'))

    const { options } = await cli.parse('node bin --config.port 3000'.split(' '))
    expect(options.config).toEqual({ port: 3000 })
  })

  test('dot-nested default uses nested object shape', async () => {
    const cli = goke()

    cli.option('--config.port [port]', z.number().default(8080).describe('Port'))

    const { options } = await cli.parse('node bin'.split(' '))
    expect(options.config).toEqual({ port: 8080 })
  })
})

describe('edge cases: kebab-case + schema', () => {
  test('kebab-case option coerced via schema and accessible as camelCase', async () => {
    const cli = goke()

    cli.option('--max-retries <count>', z.number().describe('Max retries'))

    const { options } = await cli.parse('node bin --max-retries 5'.split(' '))
    expect(options.maxRetries).toBe(5)
    expect(typeof options.maxRetries).toBe('number')
  })
})

describe('edge cases: empty string values', () => {
  test('empty string with string schema stays empty string', async () => {
    const cli = goke()

    cli.option('--name <name>', z.string().describe('Name'))

    const { options } = await cli.parse(['node', 'bin', '--name', ''])
    expect(options.name).toBe('')
  })

  test('empty string with number schema throws', async () => {
    const cli = gokeTestable()

    cli.option('--port <port>', z.number().describe('Port'))

    await expect(cli.parse(['node', 'bin', '--port', '']))
      .rejects.toThrow('expected number, got empty string')
  })

  test('empty string with nullable number schema returns null', async () => {
    const cli = goke()

    cli.option('--timeout <timeout>', z.nullable(z.number()).describe('Timeout'))

    const { options } = await cli.parse(['node', 'bin', '--timeout', ''])
    expect(options.timeout).toBe(null)
  })
})

describe('edge cases: global options with schema in subcommands', () => {
  test('global option schema applies to subcommand parsing', async () => {
    const cli = goke()
    let result: any = {}

    cli.option('--port <port>', z.number().describe('Port'))

    cli
      .command('serve', 'Start server')
      .action((options) => { result = options })

    await cli.parse('node bin serve --port 3000'.split(' '), { run: true })
    expect(result.port).toBe(3000)
    expect(typeof result.port).toBe('number')
  })
})

describe('edge cases: short alias + schema', () => {
  test('short alias repeated with array schema', async () => {
    const cli = goke()

    cli.option('-t, --tag <tag>', z.array(z.string()).describe('Tags'))

    const { options } = await cli.parse('node bin -t foo -t bar'.split(' '))
    expect(options.tag).toEqual(['foo', 'bar'])
    expect(options.t).toEqual(['foo', 'bar'])
  })

  test('short alias single value with array schema wraps', async () => {
    const cli = goke()

    cli.option('-t, --tag <tag>', z.array(z.string()).describe('Tags'))

    const { options } = await cli.parse('node bin -t foo'.split(' '))
    expect(options.tag).toEqual(['foo'])
  })

  test('short alias with number schema coerces', async () => {
    const cli = goke()

    cli.option('-p, --port <port>', z.number().describe('Port'))

    const { options } = await cli.parse('node bin -p 8080'.split(' '))
    expect(options.port).toBe(8080)
    expect(options.p).toBe(8080)
  })

  test('short alias repeated with non-array schema throws', async () => {
    const cli = gokeTestable()

    cli.option('-p, --port <port>', z.number().describe('Port'))

    await expect(cli.parse('node bin -p 3000 -p 4000'.split(' ')))
      .rejects.toThrow('does not accept multiple values')
  })
})

test('throw on unknown options', async () => {
  const cli = gokeTestable()

  cli
    .command('build [entry]', 'Build your app')
    .option('--foo-bar', 'foo bar')
    .option('--aB', 'ab')
    .action(() => {})

  await expect(cli.parse(`node bin build app.js --fooBar --a-b --xx`.split(' ')))
    .rejects.toThrowError('Unknown option `--xx`')
})

describe('space-separated subcommands', () => {
  test('basic subcommand matching', async () => {
    const cli = goke()
    let matched = ''

    cli.command('mcp login', 'Login to MCP').action(() => {
      matched = 'mcp login'
    })

    await cli.parse(['node', 'bin', 'mcp', 'login'], { run: true })
    expect(matched).toBe('mcp login')
    expect(cli.matchedCommandName).toBe('mcp login')
  })

  test('subcommand with positional args', async () => {
    const cli = goke()
    let receivedId = ''

    cli.command('mcp getNodeXml <id>', 'Get XML for a node').action((id) => {
      receivedId = id
    })

    await cli.parse(['node', 'bin', 'mcp', 'getNodeXml', '123'], { run: true })
    expect(receivedId).toBe('123')
    expect(cli.matchedCommandName).toBe('mcp getNodeXml')
  })

  test('subcommand with options', async () => {
    const cli = goke()
    let result: any = {}

    cli
      .command('mcp export <id>', 'Export something')
      .option('--format <format>', 'Output format')
      .action((id, options) => {
        result = { id, format: options.format }
      })

    await cli.parse(['node', 'bin', 'mcp', 'export', 'abc', '--format', 'json'], {
      run: true,
    })
    expect(result).toEqual({ id: 'abc', format: 'json' })
  })

  test('greedy matching - longer commands match first', async () => {
    const cli = goke()
    let matched = ''

    cli.command('mcp', 'MCP base command').action(() => {
      matched = 'mcp'
    })

    cli.command('mcp login', 'Login to MCP').action(() => {
      matched = 'mcp login'
    })

    await cli.parse(['node', 'bin', 'mcp', 'login'], { run: true })
    expect(matched).toBe('mcp login')
  })

  test('three-level subcommand', async () => {
    const cli = goke()
    let matched = ''

    cli.command('git remote add', 'Add a remote').action(() => {
      matched = 'git remote add'
    })

    await cli.parse(['node', 'bin', 'git', 'remote', 'add'], { run: true })
    expect(matched).toBe('git remote add')
    expect(cli.matchedCommandName).toBe('git remote add')
  })

  test('single-word commands still work (backward compatibility)', async () => {
    const cli = goke()
    let matched = ''

    cli.command('build', 'Build the project').action(() => {
      matched = 'build'
    })

    await cli.parse(['node', 'bin', 'build'], { run: true })
    expect(matched).toBe('build')
    expect(cli.matchedCommandName).toBe('build')
  })

  test('subcommand does not match when args are insufficient', async () => {
    const cli = goke()
    let matched = ''

    cli.command('mcp login', 'Login to MCP').action(() => {
      matched = 'mcp login'
    })

    cli.command('mcp', 'MCP base').action(() => {
      matched = 'mcp base'
    })

    await cli.parse(['node', 'bin', 'mcp'], { run: true })
    expect(matched).toBe('mcp base')
  })

  test('default command should not match if args are prefix of another command', async () => {
    const cli = goke()
    let matched = ''

    cli.command('mcp login', 'Login to MCP').action(() => {
      matched = 'mcp login'
    })

    cli.command('', 'Default command').action(() => {
      matched = 'default'
    })

    await cli.parse(['node', 'bin', 'mcp'], { run: true })
    expect(matched).toBe('')
    expect(cli.matchedCommand).toBeUndefined()
  })

  test('default command should match when args do not prefix any command', async () => {
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

    await cli.parse(['node', 'bin', 'foo'], { run: true })
    expect(matched).toBe('default')
    expect(receivedArg).toBe('foo')
  })

  test('help output with subcommands', async () => {
    let output = ''
    const cli = goke('mycli', {
      stdout: { write(data) { output += data } },
    })

    cli.command('mcp login <url>', 'Login to MCP server')
    cli.command('mcp logout', 'Logout from MCP server')
    cli.command('mcp status', 'Show connection status')
    cli.command('git remote add <name> <url>', 'Add a git remote')
    cli.command('git remote remove <name>', 'Remove a git remote')
    cli.command('build', 'Build the project').option('--watch', 'Watch mode')

    cli.help()
    // parse with --help triggers outputHelp() internally, which writes to our captured stdout
    await cli.parse(['node', 'bin', '--help'], { run: false })

    expect(stripAnsi(output)).toMatchInlineSnapshot(`
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

          --watch                    Watch mode


      Options:
        -h, --help  Display this message
      "
    `)
  })

  test('unknown subcommand shows filtered help for prefix', async () => {
    let output = ''
    const cli = goke('mycli', {
      stdout: { write(data) { output += data } },
      exit: () => {},
    })

    cli.command('mcp login', 'Login to MCP')
    cli.command('mcp logout', 'Logout from MCP')
    cli.command('mcp status', 'Show status')
    cli.command('build', 'Build project')

    cli.help()

    // User types "mcp nonexistent" - should show help for mcp commands
    await cli.parse(['node', 'bin', 'mcp', 'nonexistent'], { run: true })

    expect(cli.matchedCommand).toBeUndefined()
    const normalizedOutput = stripAnsi(output)
    expect(normalizedOutput).toContain('Unknown command: mcp nonexistent')
    expect(normalizedOutput).toContain('Available "mcp" commands:')
    expect(normalizedOutput).toContain('mcp login')
    expect(normalizedOutput).toContain('mcp logout')
    expect(normalizedOutput).toContain('mcp status')
    expect(normalizedOutput).not.toContain('build')
  })

  test('unknown command without prefix does not show filtered help', async () => {
    let output = ''
    let errOutput = ''
    const cli = goke('mycli', {
      stdout: { write(data) { output += data } },
      stderr: { write(data) { errOutput += data } },
      exit: () => {},
    })

    cli.command('mcp login', 'Login to MCP')
    cli.command('build', 'Build project')

    cli.help()

    // User types "foo" - no commands start with "foo"
    await cli.parse(['node', 'bin', 'foo'], { run: true })

    // Should not show filtered help since "foo" is not a prefix of any command
    expect(stripAnsi(output)).not.toContain('Available "foo" commands')
    // Should show error message instead of root help
    expect(stripAnsi(errOutput)).toContain('Unknown command: foo')
  })

  test('unknown command without prefix outputs error and help', async () => {
    let errOutput = ''
    let stdOutput = ''
    const cli = goke('mycli', {
      stdout: { write(data) { stdOutput += data } },
      stderr: { write(data) { errOutput += data } },
      exit: () => {},
    })

    cli.command('mcp login', 'Login to MCP')
    cli.command('build', 'Build project')

    cli.help()

    // User types an unknown command that does not match any prefix group
    await cli.parse(['node', 'bin', 'something'], { run: true })

    expect(cli.matchedCommand).toBeUndefined()
    expect(stripAnsi(errOutput)).toContain('Unknown command: something')
    // Should output help so the user can see available commands
    expect(stripAnsi(stdOutput)).toContain('Usage:')
    expect(stripAnsi(stdOutput)).toContain('mcp login')
    expect(stripAnsi(stdOutput)).toContain('build')
  })

  test('no args without default command outputs root help', async () => {
    const stdout = createTestOutputStream()
    const cli = goke('mycli', { stdout })

    cli.command('mcp login', 'Login to MCP')
    cli.command('build', 'Build project')
    cli.help()

    await cli.parse(['node', 'bin'], { run: true })

    expect(stdout.text).toContain('Usage:')
    expect(stdout.text).toContain('$ mycli <command> [options]')
    expect(stdout.text).toContain('mcp login')
    expect(stdout.text).toContain('build')
  })

  test('default command with no args rejects unknown positional args', async () => {
    const stdout = createTestOutputStream()
    let defaultRan = false
    let unknownFired = false
    const cli = gokeTestable('playwriter', { stdout })

    cli.command('', 'Start the MCP server').action(async () => { defaultRan = true })
    cli.command('session new', 'Create session').action(() => {})
    cli.help()
    cli.on('command:*', () => { unknownFired = true })

    await cli.parse(['node', 'bin', 'run'], { run: true })

    expect(defaultRan).toBe(false)
    expect(unknownFired).toBe(true)
    expect(cli.matchedCommand).toBeUndefined()
  })

  test('default command with no args still runs when no args passed', async () => {
    let defaultRan = false
    const cli = gokeTestable('playwriter')

    cli.command('', 'Start the MCP server').action(async () => { defaultRan = true })
    cli.command('session new', 'Create session').action(() => {})

    await cli.parse(['node', 'bin'], { run: true })

    expect(defaultRan).toBe(true)
  })

  test('default command with no args still works with -- separator', async () => {
    let defaultRan = false
    let receivedOptions: any = null
    const cli = gokeTestable('playwriter')

    cli.command('', 'Start the MCP server').action(async (options) => {
      defaultRan = true
      receivedOptions = options
    })

    await cli.parse(['node', 'bin', '--', 'extra', 'args'], { run: true })

    expect(defaultRan).toBe(true)
    expect(receivedOptions['--']).toEqual(['extra', 'args'])
  })

  test('default command WITH positional args still accepts args', async () => {
    let receivedScript: string | undefined
    const cli = gokeTestable('runner')

    cli.command('[script]', 'Run a script').action(async (script) => {
      receivedScript = script
    })

    await cli.parse(['node', 'bin', 'deploy'], { run: true })

    expect(receivedScript).toBe('deploy')
  })

  test('default command WITH positional args alongside other commands', async () => {
    let defaultScript: string | undefined
    let buildRan = false
    const cli = gokeTestable('mycli')

    cli.command('[file]', 'Process a file').action(async (file) => {
      defaultScript = file
    })
    cli.command('build', 'Build project').action(async () => { buildRan = true })

    // Passing an arg that is NOT a known command should route to the default
    await cli.parse(['node', 'bin', 'readme.md'], { run: true })

    expect(defaultScript).toBe('readme.md')
    expect(buildRan).toBe(false)
  })

  test('default command rejects unknown nonexistent command', async () => {
    let defaultRan = false
    let unknownFired = false
    const cli = gokeTestable('mycli')

    cli.command('', 'Default').action(async () => { defaultRan = true })
    cli.command('build', 'Build').action(() => {})
    cli.on('command:*', () => { unknownFired = true })

    await cli.parse(['node', 'bin', 'nonexistent'], { run: true })

    expect(defaultRan).toBe(false)
    expect(unknownFired).toBe(true)
  })

  test('prefix --help shows filtered help for matching command group', async () => {
    let output = ''
    const cli = goke('mycli', {
      stdout: { write(data) { output += data } },
    })

    cli.command('mcp login', 'Login to MCP')
    cli.command('mcp logout', 'Logout from MCP')
    cli.command('mcp status', 'Show status')
    cli.command('build', 'Build project')

    cli.help()
    await cli.parse(['node', 'bin', 'mcp', '--help'], { run: true })

    const normalizedOutput = stripAnsi(output)
    expect(normalizedOutput).toMatchInlineSnapshot(`
      "mycli

      Available \"mcp\" commands:

        mcp login   Login to MCP
        mcp logout  Logout from MCP
        mcp status  Show status

      Run \"mycli <command> --help\" for more information.
      "
    `)
  })
})

describe('many commands with root command (empty string)', () => {
  test('root command runs when no subcommand given', async () => {
    const cli = goke('deploy')
    let matched = ''

    cli.command('', 'Deploy the current project').action(() => {
      matched = 'root'
    })

    cli.command('init', 'Initialize project').action(() => {
      matched = 'init'
    })

    cli.command('login', 'Authenticate').action(() => {
      matched = 'login'
    })

    await cli.parse(['node', 'bin'], { run: true })
    expect(matched).toBe('root')
  })

  test('root command receives options', async () => {
    const cli = goke('deploy')
    let result: any = {}

    cli
      .command('', 'Deploy the current project')
      .option('--env <env>', z.string().default('production').describe('Target environment'))
      .option('--dry-run', 'Preview without deploying')
      .action((options) => {
        result = options
      })

    cli.command('init', 'Initialize project').action(() => {})
    cli.command('login', 'Authenticate').action(() => {})

    await cli.parse(['node', 'bin', '--env', 'staging', '--dry-run'], { run: true })
    expect(result.env).toBe('staging')
    expect(result.dryRun).toBe(true)
  })

  test('root command uses defaults when no options given', async () => {
    const cli = goke('deploy')
    let result: any = {}

    cli
      .command('', 'Deploy the current project')
      .option('--env [env]', z.string().default('production').describe('Target environment'))
      .action((options) => {
        result = options
      })

    cli.command('init', 'Initialize project').action(() => {})

    await cli.parse(['node', 'bin'], { run: true })
    expect(result.env).toBe('production')
  })

  test('subcommands take priority over root command', async () => {
    const cli = goke('deploy')
    let matched = ''

    cli.command('', 'Deploy the current project').action(() => {
      matched = 'root'
    })

    cli.command('init', 'Initialize project').action(() => {
      matched = 'init'
    })

    cli.command('login', 'Authenticate').action(() => {
      matched = 'login'
    })

    cli.command('status', 'Show status').action(() => {
      matched = 'status'
    })

    await cli.parse(['node', 'bin', 'status'], { run: true })
    expect(matched).toBe('status')
  })

  test('subcommand with args works alongside root command', async () => {
    const cli = goke('deploy')
    let rootCalled = false
    let logsResult: any = {}

    cli.command('', 'Deploy').action(() => {
      rootCalled = true
    })

    cli
      .command('logs <deploymentId>', 'Stream logs')
      .option('--follow', 'Follow output')
      .option('--lines [n]', z.number().default(100).describe('Number of lines'))
      .action((deploymentId, options) => {
        logsResult = { deploymentId, ...options }
      })

    await cli.parse(['node', 'bin', 'logs', 'abc123', '--follow', '--lines', '50'], { run: true })
    expect(rootCalled).toBe(false)
    expect(logsResult.deploymentId).toBe('abc123')
    expect(logsResult.follow).toBe(true)
    expect(logsResult.lines).toBe(50)
  })

  test('help shows root and all subcommands', async () => {
    const stdout = createTestOutputStream()
    const cli = goke('deploy', { stdout })

    cli
      .command('', 'Deploy the current project')
      .option('--env <env>', 'Target environment')

    cli.command('init', 'Initialize a new project')
    cli.command('login', 'Authenticate with the server')
    cli.command('logout', 'Clear saved credentials')
    cli.command('status', 'Show deployment status')
    cli.command('logs <deploymentId>', 'Stream logs for a deployment')

    cli.help()
    await cli.parse(['node', 'bin', '--help'], { run: false })

    expect(stdout.text).toContain('init')
    expect(stdout.text).toContain('login')
    expect(stdout.text).toContain('logout')
    expect(stdout.text).toContain('status')
    expect(stdout.text).toContain('logs <deploymentId>')
    expect(stdout.text).toContain('Initialize a new project')
    expect(stdout.text).toContain('Stream logs for a deployment')
  })

  test('root help with many commands renders examples section after options', async () => {
    const stdout = createTestOutputStream()
    const cli = goke('deploy', { stdout })

    cli
      .command('', 'Deploy the current project')
      .option('--env <env>', 'Target environment')
      .option('--dry-run', 'Preview without deploying')
      .example('# Deploy to staging first')
      .example('deploy --env staging --dry-run')

    cli.command('init', 'Initialize a new project')
    cli.command('login', 'Authenticate with the server')
    cli.command('logout', 'Clear saved credentials')
    cli.command('status', 'Show deployment status')
    cli.command('logs <deploymentId>', 'Stream logs for a deployment')

    cli.help()
    await cli.parse(['node', 'bin', '--help'], { run: false })

    expect(stdout.text).toMatchInlineSnapshot(`
      "deploy


      Usage:
        $ deploy [options]


      Commands:
        deploy               Deploy the current project


        init                 Initialize a new project


        login                Authenticate with the server


        logout               Clear saved credentials


        status               Show deployment status


        logs <deploymentId>  Stream logs for a deployment


      Options:
        --env <env>  Target environment
        --dry-run    Preview without deploying
        -h, --help   Display this message


      Examples:
      # Deploy to staging first
      deploy --env staging --dry-run
      "
    `)
  })

  test('subcommand help renders command examples at the end', async () => {
    const stdout = createTestOutputStream()
    const cli = goke('deploy', { stdout, columns: 80 })

    cli.command('', 'Deploy the current project')
    cli.command('init', 'Initialize a new project')
    cli.command('login', 'Authenticate with the server')

    cli
      .command('logs <deploymentId>', 'Stream logs for a deployment')
      .option('--follow', 'Follow log output')
      .option('--lines <n>', z.number().default(100).describe('Number of lines'))
      .example('# Stream last 200 lines for a deployment')
      .example('deploy logs dep_123 --lines 200')
      .example('# Keep following new log lines')
      .example('deploy logs dep_123 --follow')

    cli.help()
    await cli.parse(['node', 'bin', 'logs', '--help'], { run: false })

    expect(stdout.text).toMatchInlineSnapshot(`
      "deploy


      Usage:
        $ deploy logs <deploymentId>


      Options:
        --follow     Follow log output
        --lines <n>  Number of lines (default: 100)
        -h, --help   Display this message


      Description:
        Stream logs for a deployment


      Examples:
      # Stream last 200 lines for a deployment
      deploy logs dep_123 --lines 200
      # Keep following new log lines
      deploy logs dep_123 --follow
      "
    `)
  })

  test('root help labels default command with cli name and does not duplicate global options', async () => {
    const stdout = createTestOutputStream()
    const cli = goke('deploy', { stdout })

    cli.option('--env <env>', 'Target environment')
    cli
      .command('', 'Deploy the current project')
      .option('--env <env>', 'Target environment')
      .option('--dry-run', 'Preview without deploying')

    cli.command('status', 'Show deployment status')

    cli.help()
    await cli.parse(['node', 'bin', '--help'], { run: false })

    expect(stdout.text).toMatchInlineSnapshot(`
      "deploy


      Usage:
        $ deploy [options]


      Commands:
        deploy  Deploy the current project


        status  Show deployment status


      Options:
        --env <env>  Target environment
        --dry-run    Preview without deploying
        -h, --help   Display this message
      "
    `)
  })

  test('root help wraps long command descriptions snapshot', async () => {
    const stdout = createTestOutputStream()
    const cli = goke('mycli', { stdout, columns: 56 })

    cli.command(
      'notion-search',
      'Perform a semantic search over Notion workspace content and connected integrations with advanced filtering options, date filters, and creator filters.',
    )
      .option('--query <query>', 'Natural language query text to search for')
      .option('--limit [limit]', z.number().default(10).describe('Maximum number of results to return'))

    cli.command(
      'notion-fetch',
      'Retrieve a Notion page or database by URL or ID and render the result in enhanced markdown format for terminal output.',
    ).option('--id <id>', 'Notion URL or UUID to fetch')

    cli.help()
    await cli.parse(['node', 'bin', '--help'], { run: false })

    expect(stdout.text).toMatchInlineSnapshot(`
      "mycli


      Usage:
        $ mycli <command> [options]


      Commands:
        notion-search      Perform a semantic search over
                           Notion workspace content and
                           connected integrations with
                           advanced filtering options, date
                           filters, and creator filters.

          --query <query>  Natural language query text to
                           search for
          --limit [limit]  Maximum number of results to return
                           (default: 10)


        notion-fetch       Retrieve a Notion page or database
                           by URL or ID and render the result
                           in enhanced markdown format for
                           terminal output.

          --id <id>        Notion URL or UUID to fetch


      Options:
        -h, --help  Display this message
      "
    `)
  })

  test('root help aligns command descriptions with mixed command lengths', async () => {
    const stdout = createTestOutputStream()
    const cli = goke('gtui', { stdout, columns: 120 })

    cli.command('auth login', 'Authenticate with Google (opens browser)')
    cli.command('auth logout', 'Remove stored credentials').option('--force', 'Skip confirmation')
    cli.command('mail list', 'List email threads').option('--folder [folder]', 'Folder to list')
    cli.command('attachment get <messageId> <attachmentId>', 'Download an attachment')

    cli.help()
    await cli.parse(['node', 'bin', '--help'], { run: false })

    expect(stdout.text).toMatchInlineSnapshot(`
      "gtui


      Usage:
        $ gtui <command> [options]


      Commands:
        auth login                                 Authenticate with Google (opens browser)


        auth logout                                Remove stored credentials

          --force                                  Skip confirmation


        mail list                                  List email threads

          --folder [folder]                        Folder to list


        attachment get <messageId> <attachmentId>  Download an attachment


      Options:
        -h, --help  Display this message
      "
    `)
  })

  test('root help wraps all multi-line description lines', async () => {
    const stdout = createTestOutputStream()
    const cli = goke('mycli', { stdout, columns: 64 })

    cli.command(
      'notion-create',
      'Create a new page.\n  {"title":"Example"}\n  {"done":true}',
    )
    cli.help()
    await cli.parse(['node', 'bin', '--help'], { run: false })

    expect(stdout.text).toContain('{"title":"Example"}')
    expect(stdout.text).toContain('{"done":true}')
  })

  test('root help snapshot when columns is undefined (no wrapping fallback)', async () => {
    const stdout = createTestOutputStream()
    const originalColumns = process.stdout.columns

    Object.defineProperty(process.stdout, 'columns', {
      configurable: true,
      value: undefined,
    })

    try {
      const cli = goke('mycli', { stdout })

      cli.command(
        'notion-search',
        'Perform a semantic search over Notion workspace content and connected integrations with advanced filtering options, date filters, and creator filters.',
      )
        .option('--query <query>', 'Natural language query text to search for')
        .option('--limit [limit]', z.number().default(10).describe('Maximum number of results to return'))

      cli.help()
      await cli.parse(['node', 'bin', '--help'], { run: false })

      expect(stdout.text).toMatchInlineSnapshot(`
        "mycli


        Usage:
          $ mycli <command> [options]


        Commands:
          notion-search      Perform a semantic search over Notion workspace content and connected integrations with advanced filtering options, date filters, and creator filters.

            --query <query>  Natural language query text to search for
            --limit [limit]  Maximum number of results to return (default: 10)


        Options:
          -h, --help  Display this message
        "
      `)
    } finally {
      Object.defineProperty(process.stdout, 'columns', {
        configurable: true,
        value: originalColumns,
      })
    }
  })

  test('many subcommands all resolve correctly', async () => {
    const cli = goke('deploy')
    let matched = ''

    cli.command('', 'Root').action(() => { matched = 'root' })
    cli.command('init', 'Init').action(() => { matched = 'init' })
    cli.command('login', 'Login').action(() => { matched = 'login' })
    cli.command('logout', 'Logout').action(() => { matched = 'logout' })
    cli.command('status', 'Status').action(() => { matched = 'status' })
    cli.command('logs <id>', 'Logs').action(() => { matched = 'logs' })
    cli.command('rollback <id>', 'Rollback').action(() => { matched = 'rollback' })
    cli.command('config set <key> <value>', 'Set config').action(() => { matched = 'config set' })

    // Test each command resolves to the right one
    await cli.parse(['node', 'bin'], { run: true })
    expect(matched).toBe('root')

    matched = ''
    await cli.parse(['node', 'bin', 'init'], { run: true })
    expect(matched).toBe('init')

    matched = ''
    await cli.parse(['node', 'bin', 'login'], { run: true })
    expect(matched).toBe('login')

    matched = ''
    await cli.parse(['node', 'bin', 'logout'], { run: true })
    expect(matched).toBe('logout')

    matched = ''
    await cli.parse(['node', 'bin', 'status'], { run: true })
    expect(matched).toBe('status')

    matched = ''
    await cli.parse(['node', 'bin', 'logs', 'dep-123'], { run: true })
    expect(matched).toBe('logs')

    matched = ''
    await cli.parse(['node', 'bin', 'rollback', 'dep-456'], { run: true })
    expect(matched).toBe('rollback')

    matched = ''
    await cli.parse(['node', 'bin', 'config', 'set', 'region', 'us-east-1'], { run: true })
    expect(matched).toBe('config set')
  })
})

describe('stdout/stderr/argv injection', () => {
  test('stdout captures help output', async () => {
    const stdout = createTestOutputStream()
    const cli = goke('mycli', { stdout })

    cli.command('serve', 'Start server')
    cli.help()
    await cli.parse(['node', 'bin', '--help'], { run: false })
    cli.outputHelp()

    expect(stdout.text).toContain('mycli')
    expect(stdout.text).toContain('serve')
    expect(stdout.text).toContain('Start server')
  })

  test('stdout captures version output', async () => {
    const stdout = createTestOutputStream()
    const cli = goke('mycli', { stdout })

    cli.version('1.2.3')
    await cli.parse(['node', 'bin', '--version'], { run: false })
    cli.outputVersion()

    expect(stdout.text).toContain('mycli/1.2.3')
  })

  test('stdout captures prefix help for unknown subcommands', async () => {
    const stdout = createTestOutputStream()
    const cli = goke('mycli', { stdout, exit: () => {} })

    cli.command('mcp login', 'Login to MCP')
    cli.command('mcp logout', 'Logout from MCP')
    cli.help()

    await cli.parse(['node', 'bin', 'mcp', 'nonexistent'], { run: true })

    expect(stdout.text).toContain('Unknown command: mcp nonexistent')
    expect(stdout.text).toContain('mcp login')
    expect(stdout.text).toContain('mcp logout')
  })

  test('stderr is separate from stdout', async () => {
    const stdout = createTestOutputStream()
    const stderr = createTestOutputStream()
    const cli = goke('mycli', { stdout, stderr })

    cli.console.log('hello stdout')
    cli.console.error('hello stderr')

    expect(stdout.text).toBe('hello stdout\n')
    expect(stderr.text).toBe('hello stderr\n')
  })

  test('argv option is used as default in parse()', async () => {
    const cli = goke('mycli', {
      argv: ['node', 'bin', 'serve', '--port', '3000'],
    })

    let result: any = {}
    cli
      .command('serve', 'Start server')
      .option('--port <port>', z.number().describe('Port'))
      .action((options) => { result = options })

    // parse() without args uses the injected argv
    await cli.parse()

    expect(result.port).toBe(3000)
  })

  test('parse(customArgv) overrides injected argv', async () => {
    const cli = goke('mycli', {
      argv: ['node', 'bin', 'serve', '--port', '3000'],
    })

    let result: any = {}
    cli
      .command('serve', 'Start server')
      .option('--port <port>', z.number().describe('Port'))
      .action((options) => { result = options })

    // Explicit argv overrides the default
    await cli.parse(['node', 'bin', 'serve', '--port', '8080'])

    expect(result.port).toBe(8080)
  })

  test('default behavior without options uses process.stdout', async () => {
    const cli = goke('mycli')

    // stdout/stderr should be process.stdout/process.stderr by default
    expect(cli.stdout).toBe(process.stdout)
    expect(cli.stderr).toBe(process.stderr)
  })

  test('createConsole routes log to stdout and error to stderr', async () => {
    const stdout = createTestOutputStream()
    const stderr = createTestOutputStream()
    const con = createConsole(stdout, stderr)

    con.log('msg1', 'msg2')
    con.error('err1', 'err2')

    expect(stdout.text).toBe('msg1 msg2\n')
    expect(stderr.text).toBe('err1 err2\n')
  })

  test('createConsole log with no args writes empty line', async () => {
    const stdout = createTestOutputStream()
    const stderr = createTestOutputStream()
    const con = createConsole(stdout, stderr)

    con.log()

    expect(stdout.text).toBe('\n')
  })
})

describe('schema description and default extraction', () => {
  test('description is extracted from schema and shown in help', async () => {
    const stdout = createTestOutputStream()
    const cli = goke('mycli', { stdout })

    cli
      .command('serve', 'Start server')
      .option('--port <port>', z.number().describe('Port to listen on'))

    cli.help()
    await cli.parse(['node', 'bin', 'serve', '--help'], { run: false })

    expect(stdout.text).toContain('Port to listen on')
  })

  test('default is extracted from schema and shown in help', async () => {
    const stdout = createTestOutputStream()
    const cli = goke('mycli', { stdout })

    cli
      .command('serve', 'Start server')
      .option('--port [port]', z.number().default(3000).describe('Port'))

    cli.help()
    await cli.parse(['node', 'bin', 'serve', '--help'], { run: false })

    expect(stdout.text).toContain('(default: 3000)')
  })

  test('deprecated options are hidden from help output', async () => {
    const stdout = createTestOutputStream()
    const cli = goke('mycli', { stdout })

    cli
      .command('serve', 'Start server')
      .option('--old <value>', z.string().meta({ deprecated: true, description: 'Old option' }))
      .option('--new <value>', z.string().describe('Normal option'))

    cli.help()
    await cli.parse(['node', 'bin', 'serve', '--help'], { run: false })

    // Normal option should be visible
    expect(stdout.text).toContain('--new')
    expect(stdout.text).toContain('Normal option')
    // Deprecated option should be hidden
    expect(stdout.text).not.toContain('--old')
    expect(stdout.text).not.toContain('Old option')
  })

  test('deprecated option still works for parsing (just hidden from help)', async () => {
    const cli = gokeTestable('mycli')

    let result: any = {}
    cli
      .command('serve', 'Start server')
      .option('--old <value>', z.string().meta({ deprecated: true, description: 'Old option' }))
      .action((options) => { result = options })

    await cli.parse(['node', 'bin', 'serve', '--old', 'legacy-value'])

    // Deprecated option should still be parsed and usable
    expect(result.old).toBe('legacy-value')
  })

  test('deprecated options hidden from global help', async () => {
    const stdout = createTestOutputStream()
    const cli = goke('mycli', { stdout })

    cli.option('--legacy [value]', z.string().meta({ deprecated: true, description: 'Deprecated global' }))
    cli.option('--current [value]', z.string().describe('Current option'))

    cli.help()
    await cli.parse(['node', 'bin', '--help'], { run: false })

    expect(stdout.text).toContain('--current')
    expect(stdout.text).toContain('Current option')
    expect(stdout.text).not.toContain('--legacy')
    expect(stdout.text).not.toContain('Deprecated global')
  })

  test('hidden commands are not shown in help output', async () => {
    const stdout = createTestOutputStream()
    const cli = goke('mycli', { stdout })

    cli.command('visible', 'A visible command')
    cli.command('secret', 'A hidden command').hidden()

    cli.help()
    await cli.parse(['node', 'bin', '--help'], { run: false })

    expect(stdout.text).toContain('visible')
    expect(stdout.text).toContain('A visible command')
    expect(stdout.text).not.toContain('secret')
    expect(stdout.text).not.toContain('A hidden command')
  })

  test('hidden command still parses and runs', async () => {
    const cli = gokeTestable('mycli')

    let result: any = {}
    cli
      .command('secret', 'A hidden command')
      .hidden()
      .option('--value <v>', z.string().describe('some value'))
      .action((options) => { result = options })

    await cli.parse(['node', 'bin', 'secret', '--value', 'hello'])

    expect(result.value).toBe('hello')
  })
})

describe('helpText()', () => {
  test('returns help string without printing', async () => {
    const stdout = createTestOutputStream()
    const cli = goke('mycli', { stdout })

    cli.command('serve', 'Start server')
    cli.option('--port <port>', 'Port number')
    cli.help()
    // parse a known command so help is not auto-triggered
    await cli.parse(['node', 'bin', 'serve'], { run: false })

    // reset stdout after parse
    stdout.lines.length = 0

    const text = stripAnsi(cli.helpText())

    expect(text).toContain('mycli')
    expect(text).toContain('serve')
    expect(text).toContain('Start server')
    expect(text).toContain('--port')
    // helpText() does not print to stdout
    expect(stdout.text).toBe('')
  })

  test('returns same content as outputHelp', async () => {
    const stdout = createTestOutputStream()
    const cli = goke('mycli', { stdout })

    cli.command('build', 'Build project')
    cli.option('--watch [watch]', 'Watch mode')
    cli.help()
    // parse a known command so help is not auto-triggered
    await cli.parse(['node', 'bin', 'build'], { run: false })

    // reset stdout after parse
    stdout.lines.length = 0

    const helpTextResult = stripAnsi(cli.helpText())
    cli.outputHelp()
    // outputHelp adds a trailing newline via console.log
    const outputHelpResult = stdout.text.replace(/\n$/, '')

    expect(helpTextResult).toBe(outputHelpResult)
  })

  test('returns subcommand help when command is matched', async () => {
    const cli = goke('mycli')

    cli.command('deploy <env>', 'Deploy to environment')
      .option('--force', 'Force deploy')

    cli.help()
    await cli.parse(['node', 'bin', 'deploy', '--help'], { run: false })

    const text = stripAnsi(cli.helpText())

    expect(text).toContain('deploy')
    expect(text).toContain('--force')
    expect(text).toContain('Force deploy')
  })

  test('works without calling parse', async () => {
    const cli = goke('mycli')

    cli.command('test', 'Run tests')
    cli.option('--coverage', 'Enable coverage')
    cli.help()

    // helpText() works even without parse
    const text = stripAnsi(cli.helpText())

    expect(text).toContain('mycli')
    expect(text).toContain('test')
    expect(text).toContain('Run tests')
    expect(text).toContain('--coverage')
  })
})

describe('middleware', () => {
  test('middleware runs before command action', async () => {
    const cli = goke('mycli')
    const order: string[] = []

    cli
      .option('--verbose', 'Verbose')
      .use(() => {
        order.push('middleware')
      })

    cli
      .command('build', 'Build')
      .action(() => {
        order.push('action')
      })

    await cli.parse(['node', 'bin', 'build'], { run: true })
    expect(order).toEqual(['middleware', 'action'])
  })

  test('multiple middleware run in registration order', async () => {
    const cli = goke('mycli')
    const order: string[] = []

    cli
      .use(() => { order.push('mw1') })
      .use(() => { order.push('mw2') })
      .use(() => { order.push('mw3') })

    cli
      .command('deploy', 'Deploy')
      .action(() => { order.push('action') })

    await cli.parse(['node', 'bin', 'deploy'], { run: true })
    expect(order).toEqual(['mw1', 'mw2', 'mw3', 'action'])
  })

  test('middleware receives parsed global options', async () => {
    const cli = goke('mycli')
    let received: any = null

    cli
      .option('--verbose', 'Verbose')
      .use((options) => {
        received = { ...options }
      })

    cli
      .command('build', 'Build')
      .action(() => {})

    await cli.parse(['node', 'bin', 'build', '--verbose'], { run: true })
    expect(received.verbose).toBe(true)
  })

  test('middleware receives schema-coerced global options', async () => {
    const cli = goke('mycli')
    let received: any = null

    cli
      .option('--port <port>', z.number().describe('Port'))
      .use((options) => {
        received = { ...options }
      })

    cli
      .command('serve', 'Serve')
      .action(() => {})

    await cli.parse(['node', 'bin', 'serve', '--port', '3000'], { run: true })
    expect(received.port).toBe(3000)
    expect(typeof received.port).toBe('number')
  })

  test('async middleware awaited before command action', async () => {
    const cli = goke('mycli')
    const order: string[] = []

    cli.use(async () => {
      await new Promise((r) => setTimeout(r, 10))
      order.push('async-mw')
    })

    cli
      .command('run', 'Run')
      .action(() => { order.push('action') })

    await cli.parse(['node', 'bin', 'run'], { run: true })

    // Wait for async chain to complete
    await new Promise((r) => setTimeout(r, 50))
    expect(order).toEqual(['async-mw', 'action'])
  })

  test('async middleware error is caught and formatted', async () => {
    const stderr = createTestOutputStream()
    let exitCode: number | undefined
    const cli = goke('mycli', { stderr, exit: (code) => { exitCode = code } })

    cli.use(async () => {
      throw new Error('middleware failed')
    })

    cli
      .command('deploy', 'Deploy')
      .action(() => {})

    await cli.parse(['node', 'bin', 'deploy'], { run: true })

    await new Promise((r) => setTimeout(r, 10))
    expect(exitCode).toBe(1)
    expect(stripStackTrace(stderr.text)).toMatchInlineSnapshot(`"error: middleware failed"`)
  })

  test('middleware does not run with { run: false }', async () => {
    const cli = goke('mycli')
    let middlewareCalled = false

    cli.use(() => { middlewareCalled = true })

    cli
      .command('build', 'Build')
      .action(() => {})

    await cli.parse(['node', 'bin', 'build'], { run: false })
    expect(middlewareCalled).toBe(false)
  })

  test('middleware does not run for help', async () => {
    const stdout = createTestOutputStream()
    const cli = goke('mycli', { stdout })
    let middlewareCalled = false

    cli.use(() => { middlewareCalled = true })
    cli.help()

    cli
      .command('build', 'Build')
      .action(() => {})

    await cli.parse(['node', 'bin', '--help'], { run: true })
    expect(middlewareCalled).toBe(false)
  })

  test('middleware does not run when no command matched', async () => {
    const stdout = createTestOutputStream()
    const cli = goke('mycli', { stdout, exit: () => {} })
    let middlewareCalled = false

    cli.use(() => { middlewareCalled = true })
    cli.help()

    cli
      .command('build', 'Build')
      .action(() => {})

    await cli.parse(['node', 'bin', 'nonexistent'], { run: true })
    expect(middlewareCalled).toBe(false)
  })

  test('middleware runs for default command', async () => {
    const cli = goke('mycli')
    const order: string[] = []

    cli.use(() => { order.push('mw') })

    cli
      .command('', 'Default')
      .action(() => { order.push('action') })

    await cli.parse(['node', 'bin'], { run: true })
    expect(order).toEqual(['mw', 'action'])
  })

  test('sync middleware error is caught and formatted', async () => {
    const stderr = createTestOutputStream()
    let exitCode: number | undefined
    const cli = goke('mycli', { stderr, exit: (code) => { exitCode = code } })

    cli.use(() => {
      throw new Error('middleware exploded')
    })

    cli
      .command('deploy', 'Deploy')
      .action(() => {})

    await cli.parse(['node', 'bin', 'deploy'], { run: true })

    expect(exitCode).toBe(1)
    expect(stripStackTrace(stderr.text)).toMatchInlineSnapshot(`"error: middleware exploded"`)
  })

  test('sync middleware error short-circuits command action', async () => {
    const stderr = createTestOutputStream()
    const cli = goke('mycli', { stderr, exit: () => {} })
    let actionCalled = false

    cli.use(() => {
      throw new Error('abort')
    })

    cli
      .command('build', 'Build')
      .action(() => { actionCalled = true })

    await cli.parse(['node', 'bin', 'build'], { run: true })

    expect(actionCalled).toBe(false)
  })

  test('mixed sync and async middleware chain correctly', async () => {
    const cli = goke('mycli')
    const order: string[] = []

    cli
      .use(() => { order.push('sync1') })
      .use(async () => {
        await new Promise((r) => setTimeout(r, 10))
        order.push('async')
      })
      .use(() => { order.push('sync2') })

    cli
      .command('run', 'Run')
      .action(() => { order.push('action') })

    await cli.parse(['node', 'bin', 'run'], { run: true })

    await new Promise((r) => setTimeout(r, 50))
    expect(order).toEqual(['sync1', 'async', 'sync2', 'action'])
  })
})

describe('use() with sub-CLI composition', () => {
  test('basic composition: sub-CLI command runs via parent', async () => {
    const parent = goke('mycli')
    const sub = goke()
    let matched = ''

    sub
      .command('deploy', 'Deploy the app')
      .action(() => { matched = 'deploy' })

    parent.use(sub)
    await parent.parse(['node', 'bin', 'deploy'], { run: true })
    expect(matched).toBe('deploy')
  })

  test('multiple sub-CLIs composed together', async () => {
    const parent = goke('mycli')
    const subA = goke()
    const subB = goke()
    let matched = ''

    subA.command('login', 'Login').action(() => { matched = 'login' })
    subB.command('deploy', 'Deploy').action(() => { matched = 'deploy' })

    parent.use(subA).use(subB)

    await parent.parse(['node', 'bin', 'login'], { run: true })
    expect(matched).toBe('login')

    matched = ''
    await parent.parse(['node', 'bin', 'deploy'], { run: true })
    expect(matched).toBe('deploy')
  })

  test('sub-CLI command with options and schema coercion', async () => {
    const parent = goke('mycli')
    const sub = goke()
    let result: any = {}

    sub
      .command('serve', 'Start server')
      .option('--port <port>', z.number().describe('Port'))
      .option('--host <host>', z.string().describe('Host'))
      .action((options) => { result = options })

    parent.use(sub)
    await parent.parse('node bin serve --port 3000 --host localhost'.split(' '), { run: true })

    expect(result.port).toBe(3000)
    expect(typeof result.port).toBe('number')
    expect(result.host).toBe('localhost')
  })

  test('sub-CLI command with positional args', async () => {
    const parent = goke('mycli')
    const sub = goke()
    let receivedId = ''

    sub
      .command('get <id>', 'Get a resource')
      .action((id) => { receivedId = id })

    parent.use(sub)
    await parent.parse(['node', 'bin', 'get', 'abc123'], { run: true })

    expect(receivedId).toBe('abc123')
  })

  test('sub-CLI with multi-word commands', async () => {
    const parent = goke('mycli')
    const sub = goke()
    let matched = ''

    sub.command('mcp login', 'Login to MCP').action(() => { matched = 'mcp login' })
    sub.command('mcp logout', 'Logout from MCP').action(() => { matched = 'mcp logout' })

    parent.use(sub)

    await parent.parse(['node', 'bin', 'mcp', 'login'], { run: true })
    expect(matched).toBe('mcp login')

    matched = ''
    await parent.parse(['node', 'bin', 'mcp', 'logout'], { run: true })
    expect(matched).toBe('mcp logout')
  })

  test('help output includes composed commands', async () => {
    const stdout = createTestOutputStream()
    const parent = goke('mycli', { stdout })
    const sub = goke()

    sub.command('selfhost', 'Set up on your own workspace')
      .option('-t, --token [token]', 'Admin token')

    parent.command('init', 'Initialize project')
    parent.use(sub)
    parent.help()
    await parent.parse(['node', 'bin', '--help'], { run: false })

    expect(stdout.text).toContain('init')
    expect(stdout.text).toContain('selfhost')
    expect(stdout.text).toContain('Set up on your own workspace')
  })

  test('sub-CLI middlewares are NOT copied to parent', async () => {
    const parent = goke('mycli')
    const sub = goke()
    let subMiddlewareCalled = false
    const order: string[] = []

    sub.use(() => { subMiddlewareCalled = true })
    sub.command('deploy', 'Deploy').action(() => { order.push('deploy') })

    parent.use(() => { order.push('parent-mw') })
    parent.use(sub)

    await parent.parse(['node', 'bin', 'deploy'], { run: true })

    expect(subMiddlewareCalled).toBe(false)
    expect(order).toEqual(['parent-mw', 'deploy'])
  })

  test('parent global options are available to composed commands', async () => {
    const parent = goke('mycli')
    const sub = goke()
    let result: any = {}

    parent.option('--verbose', 'Verbose output')

    sub
      .command('build', 'Build')
      .option('--target <target>', 'Build target')
      .action((options) => { result = options })

    parent.use(sub)
    await parent.parse('node bin build --verbose --target production'.split(' '), { run: true })

    expect(result.verbose).toBe(true)
    expect(result.target).toBe('production')
  })

  test('composed commands coexist with inline commands', async () => {
    const parent = goke('mycli')
    const sub = goke()
    let matched = ''

    parent.command('init', 'Initialize').action(() => { matched = 'init' })

    sub.command('deploy', 'Deploy').action(() => { matched = 'deploy' })
    sub.command('rollback', 'Rollback').action(() => { matched = 'rollback' })

    parent.use(sub)

    await parent.parse(['node', 'bin', 'init'], { run: true })
    expect(matched).toBe('init')

    matched = ''
    await parent.parse(['node', 'bin', 'deploy'], { run: true })
    expect(matched).toBe('deploy')

    matched = ''
    await parent.parse(['node', 'bin', 'rollback'], { run: true })
    expect(matched).toBe('rollback')
  })
})

describe('getAction()', () => {
  test('returns the action callable with correct behavior', async () => {
    const stdout = createTestOutputStream()
    const cli = goke('mycli', { stdout, exit: () => {} })

    const cmd = cli
      .command('deploy', 'Deploy the app')
      .option('--env <env>', z.enum(['staging', 'production']).describe('Target environment'))
      .action((options, { console }) => {
        console.log(`Deploying to ${options.env}`)
      })

    const action = cmd.getAction()
    const ctx = cli.createExecutionContext()
    action({ env: 'staging' as const, '--': [] }, ctx)
    expect(stdout.text).toBe('Deploying to staging\n')
  })

  test('works with positional args', async () => {
    const stdout = createTestOutputStream()
    const cli = goke('mycli', { stdout, exit: () => {} })

    const cmd = cli
      .command('get <id>', 'Fetch by id')
      .option('--format <format>', z.string().describe('Output format'))
      .action((id, options, { console }) => {
        console.log(`${id}:${options.format}`)
      })

    const action = cmd.getAction()
    const ctx = cli.createExecutionContext()
    action('abc123', { format: 'json', '--': [] }, ctx)
    expect(stdout.text).toBe('abc123:json\n')
  })

  test('throws when no action is registered', async () => {
    const cli = goke('mycli')
    const cmd = cli.command('noop', 'No action')
    expect(() => cmd.getAction()).toThrow(/No action registered/)
  })
})

describe('command routing with conflicting enum options', () => {
  test('commands with same option name but different enums route correctly', async () => {
    const cli = gokeTestable('egaki')
    let matched = ''

    cli.command('image <prompt>', 'Generate images')
      .option('-m, --model [model]', z.enum(['imagen-4', 'dall-e-3']).describe('Image model'))
      .action((prompt, options) => { matched = `image:${prompt}:${options.model}` })

    cli.command('video <prompt>', 'Generate videos')
      .option('-m, --model [model]', z.enum(['veo-3', 'grok-video']).describe('Video model'))
      .action((prompt, options) => { matched = `video:${prompt}:${options.model}` })

    await cli.parse(['node', 'bin', 'video', 'test', '--model', 'grok-video'])
    expect(matched).toBe('video:test:grok-video')
  })

  test('first-defined command still works with its own enum values', async () => {
    const cli = gokeTestable('egaki')
    let matched = ''

    cli.command('image <prompt>', 'Generate images')
      .option('-m, --model [model]', z.enum(['imagen-4', 'dall-e-3']).describe('Image model'))
      .action((prompt, options) => { matched = `image:${prompt}:${options.model}` })

    cli.command('video <prompt>', 'Generate videos')
      .option('-m, --model [model]', z.enum(['veo-3', 'grok-video']).describe('Video model'))
      .action((prompt, options) => { matched = `video:${prompt}:${options.model}` })

    await cli.parse(['node', 'bin', 'image', 'sunset', '--model', 'dall-e-3'])
    expect(matched).toBe('image:sunset:dall-e-3')
  })

  test('parent child command matches before parent <arg>', async () => {
    const cli = gokeTestable('mycli')
    let matched = ''

    cli.command('parent <arg>', 'Parent with positional')
      .action((arg) => { matched = `parent:${arg}` })

    cli.command('parent child', 'Parent child subcommand')
      .action(() => { matched = 'parent child' })

    await cli.parse(['node', 'bin', 'parent', 'child'])
    expect(matched).toBe('parent child')
  })

  test('parent <arg> still works for non-subcommand args', async () => {
    const cli = gokeTestable('mycli')
    let matched = ''

    cli.command('parent <arg>', 'Parent with positional')
      .action((arg) => { matched = `parent:${arg}` })

    cli.command('parent child', 'Parent child subcommand')
      .action(() => { matched = 'parent child' })

    await cli.parse(['node', 'bin', 'parent', 'something'])
    expect(matched).toBe('parent:something')
  })

  test('multi-word commands with same first word and conflicting enums route correctly', async () => {
    const cli = gokeTestable('egaki')
    let matched = ''

    cli.command('image create <prompt>', 'Create image')
      .option('--model [model]', z.enum(['imagen']).describe('Create model'))
      .action((prompt, options) => { matched = `create:${prompt}:${options.model}` })

    cli.command('image edit <prompt>', 'Edit image')
      .option('--model [model]', z.enum(['edit-model']).describe('Edit model'))
      .action((prompt, options) => { matched = `edit:${prompt}:${options.model}` })

    await cli.parse(['node', 'bin', 'image', 'edit', 'test', '--model', 'edit-model'])
    expect(matched).toBe('edit:test:edit-model')
  })

  test('aliased command with conflicting enum routes correctly', async () => {
    const cli = gokeTestable('egaki')
    let matched = ''

    cli.command('image <prompt>', 'Generate images')
      .option('--model [model]', z.enum(['imagen']).describe('Image model'))
      .action((prompt, options) => { matched = `image:${prompt}:${options.model}` })

    cli.command('video <prompt>', 'Generate videos')
      .alias('v')
      .option('--model [model]', z.enum(['veo']).describe('Video model'))
      .action((prompt, options) => { matched = `video:${prompt}:${options.model}` })

    await cli.parse(['node', 'bin', 'v', 'test', '--model', 'veo'])
    expect(matched).toBe('video:test:veo')
  })

  test('global boolean flag before command does not disable routing precheck', async () => {
    const cli = gokeTestable('egaki')
    let matched = ''

    cli.option('--verbose', 'Verbose output')

    cli.command('image <prompt>', 'Generate images')
      .option('--model [model]', z.enum(['imagen']).describe('Image model'))
      .action((prompt, options) => { matched = `image:${prompt}:${options.model}` })

    cli.command('video <prompt>', 'Generate videos')
      .option('--model [model]', z.enum(['veo']).describe('Video model'))
      .action((prompt, options) => { matched = `video:${prompt}:${options.model}` })

    await cli.parse(['node', 'bin', '--verbose', 'video', 'test', '--model', 'veo'])
    expect(matched).toBe('video:test:veo')
  })

  test('global value option before command keeps routing precheck enabled', async () => {
    const cli = gokeTestable('egaki')
    let matched = ''

    cli.option('--config <path>', z.string().describe('Config path'))

    cli.command('image <prompt>', 'Generate images')
      .option('--model [model]', z.enum(['imagen']).describe('Image model'))
      .action((prompt, options) => { matched = `image:${prompt}:${options.model}` })

    cli.command('video <prompt>', 'Generate videos')
      .option('--model [model]', z.enum(['veo']).describe('Video model'))
      .action((prompt, options) => { matched = `video:${prompt}:${options.model}` })

    await cli.parse(['node', 'bin', '--config', 'config.json', 'video', 'test', '--model', 'veo'])
    expect(matched).toBe('video:test:veo')
  })

  test('global value option with equals syntax keeps routing precheck enabled', async () => {
    const cli = gokeTestable('egaki')
    let matched = ''

    cli.option('--config <path>', z.string().describe('Config path'))

    cli.command('image <prompt>', 'Generate images')
      .option('--model [model]', z.enum(['imagen']).describe('Image model'))
      .action((prompt, options) => { matched = `image:${prompt}:${options.model}` })

    cli.command('video <prompt>', 'Generate videos')
      .option('--model [model]', z.enum(['veo']).describe('Video model'))
      .action((prompt, options) => { matched = `video:${prompt}:${options.model}` })

    await cli.parse(['node', 'bin', '--config=config.json', 'video', 'test', '--model', 'veo'])
    expect(matched).toBe('video:test:veo')
  })

  test('global boolean flag with explicit equals value keeps routing precheck enabled', async () => {
    const cli = gokeTestable('egaki')
    let matched = ''

    cli.option('--verbose', 'Verbose output')

    cli.command('image <prompt>', 'Generate images')
      .option('--model [model]', z.enum(['imagen']).describe('Image model'))
      .action((prompt, options) => { matched = `image:${prompt}:${options.model}` })

    cli.command('video <prompt>', 'Generate videos')
      .option('--model [model]', z.enum(['veo']).describe('Video model'))
      .action((prompt, options) => { matched = `video:${prompt}:${options.model}` })

    await cli.parse(['node', 'bin', '--verbose=false', 'video', 'test', '--model', 'veo'])
    expect(matched).toBe('video:test:veo')
  })
})
