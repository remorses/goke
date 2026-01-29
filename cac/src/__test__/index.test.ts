import { describe, test, expect } from 'vitest'
import cac from '..'

test('negated option', () => {
  const cli = cac()

  cli.option('--foo [foo]', 'Set foo').option('--no-foo', 'Disable foo')
  cli.option('--bar [bar]', 'Set bar').option('--no-bar', 'Disable bar')

  const { options } = cli.parse(['node', 'bin', '--foo', 'foo', '--bar'])
  expect(options).toEqual({
    '--': [],
    foo: 'foo',
    bar: true,
  })
})

test('double dashes', () => {
  const cli = cac()

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

test('default value for negated option', () => {
  const cli = cac()

  cli.option('--no-clear-screen', 'no clear screen')
  cli.option('--no-a-b, --no-c-d', 'desc')

  const { options } = cli.parse(`node bin`.split(' '))

  expect(options).toEqual({ '--': [], clearScreen: true, aB: true, cD: true })
})

test('negated option validation', () => {
  const cli = cac()

  cli.option('--config <config>', 'config file')
  cli.option('--no-config', 'no config file')

  const { options } = cli.parse(`node bin --no-config`.split(' '))

  cli.globalCommand.checkOptionValue()
  expect(options.config).toBe(false)
})

test('array types without transformFunction', () => {
  const cli = cac()

  cli
    .option(
      '--externals <external>',
      'Add externals(can be used for multiple times',
      {
        type: [],
      }
    )
    .option('--scale [level]', 'Scaling level')

  const { options: options1 } = cli.parse(
    `node bin --externals.env.prod production --scale`.split(' ')
  )
  expect(options1.externals).toEqual([{ env: { prod: 'production' } }])
  expect(options1.scale).toEqual(true)

  const { options: options2 } = cli.parse(
    `node bin --externals foo --externals bar`.split(' ')
  )
  expect(options2.externals).toEqual(['foo', 'bar'])

  const { options: options3 } = cli.parse(
    `node bin --externals.env foo --externals.env bar`.split(' ')
  )
  expect(options3.externals).toEqual([{ env: ['foo', 'bar'] }])
})

test('array types with transformFunction', () => {
  const cli = cac()

  cli
    .command('build [entry]', 'Build your app')
    .option('--config <configFlie>', 'Use config file for building', {
      type: [String],
    })
    .option('--scale [level]', 'Scaling level')

  const { options } = cli.parse(
    `node bin build app.js --config config.js --scale`.split(' ')
  )
  expect(options.config).toEqual(['config.js'])
  expect(options.scale).toEqual(true)
})

test('throw on unknown options', () => {
  const cli = cac()

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
    const cli = cac()
    let matched = ''

    cli.command('mcp login', 'Login to MCP').action(() => {
      matched = 'mcp login'
    })

    cli.parse(['node', 'bin', 'mcp', 'login'], { run: true })
    expect(matched).toBe('mcp login')
    expect(cli.matchedCommandName).toBe('mcp login')
  })

  test('subcommand with positional args', () => {
    const cli = cac()
    let receivedId = ''

    cli.command('mcp getNodeXml <id>', 'Get XML for a node').action((id) => {
      receivedId = id
    })

    cli.parse(['node', 'bin', 'mcp', 'getNodeXml', '123'], { run: true })
    expect(receivedId).toBe('123')
    expect(cli.matchedCommandName).toBe('mcp getNodeXml')
  })

  test('subcommand with options', () => {
    const cli = cac()
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
    const cli = cac()
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
    const cli = cac()
    let matched = ''

    cli.command('git remote add', 'Add a remote').action(() => {
      matched = 'git remote add'
    })

    cli.parse(['node', 'bin', 'git', 'remote', 'add'], { run: true })
    expect(matched).toBe('git remote add')
    expect(cli.matchedCommandName).toBe('git remote add')
  })

  test('single-word commands still work (backward compatibility)', () => {
    const cli = cac()
    let matched = ''

    cli.command('build', 'Build the project').action(() => {
      matched = 'build'
    })

    cli.parse(['node', 'bin', 'build'], { run: true })
    expect(matched).toBe('build')
    expect(cli.matchedCommandName).toBe('build')
  })

  test('subcommand does not match when args are insufficient', () => {
    const cli = cac()
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
    const cli = cac()
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
    const cli = cac()
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
    const cli = cac('mycli')

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
    const cli = cac('mycli')

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
    const cli = cac('mycli')

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
