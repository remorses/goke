/**
 * Smoke tests that keep README examples and documented APIs executable.
 */

import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import goke, { openInBrowser, generateDocs } from '../index.js'
import type { GokeOptions, GokeOutputStream } from '../index.js'

const ANSI_RE = /\x1B\[[0-9;]*m/g

const stripAnsi = (text: string) => text.replace(ANSI_RE, '')

function createTestOutputStream(): GokeOutputStream & { lines: string[]; readonly text: string } {
  const lines: string[] = []
  return {
    lines,
    get text() { return stripAnsi(lines.join('')) },
    write(data: string) { lines.push(data) },
  }
}

function gokeTestable(name = '', options?: Partial<GokeOptions>) {
  return goke(name, {
    ...options,
    exit: () => {},
  })
}

describe('README smoke tests', () => {
  test('intro example runs middleware and both command forms', async () => {
    const stdout = createTestOutputStream()
    const cli = gokeTestable('deploy', { stdout })

    cli
      .option('--env <env>', z.enum(['staging', 'production']).default('staging').describe('Target environment'))
      .use((options, { console }) => {
        console.log(`Environment: ${options.env}`)
      })

    cli
      .command('up', 'Deploy the app')
      .option('--dry-run', 'Preview without deploying')
      .action((options, { console, process }) => {
        console.log(`Deploying from ${process.cwd} dryRun=${String(options.dryRun)}`)
      })

    cli
      .command('logs <deploymentId>', 'Stream logs')
      .option('--lines <n>', z.number().default(100).describe('Lines to tail'))
      .action((deploymentId, options, { console }) => {
        console.log(`logs ${deploymentId} ${options.lines}`)
      })

    cli.parse(['node', 'bin', '--env', 'production', 'up', '--dry-run'], { run: false })
    await cli.runMatchedCommand()

    expect(stdout.text).toBe(
      `Environment: production\nDeploying from ${process.cwd()} dryRun=true\n`,
    )

    stdout.lines.length = 0

    cli.parse(['node', 'bin', 'logs', 'dep_123'], { run: false })
    await cli.runMatchedCommand()

    expect(stdout.text).toBe('Environment: staging\nlogs dep_123 100\n')
  })

  test('simple parsing example stays executable and keeps examples in help output', async () => {
    const stdout = createTestOutputStream()
    const cli = gokeTestable('mycli', { stdout })

    cli.option(
      '--type [type]',
      z.string().default('node').describe('Choose a project type'),
    )
    cli.option('--name <name>', 'Provide your name')

    cli.command('lint [...files]', 'Lint files').action((files, options, { console, process }) => {
      console.log(JSON.stringify({ files, options, cwd: process.cwd }))
    })

    cli
      .command('build [entry]', 'Build your app')
      .option('--minify', 'Minify output')
      .example('build src/index.ts')
      .example('build src/index.ts --minify')
      .action(async (entry, options, { console, process }) => {
        console.log(JSON.stringify({ entry, options, nodeEnv: process.env.NODE_ENV }))
      })

    cli.example((bin) => `${bin} lint src/**/*.ts`)
    cli.help()
    cli.version('0.0.0')

    expect(stripAnsi(cli.helpText())).toContain('mycli lint src/**/*.ts')

    cli.parse(['node', 'bin', '--type', 'bun', '--name', 'Tommy', 'build', 'src/index.ts', '--minify'], { run: false })
    await cli.runMatchedCommand()

    expect(stdout.text).toBe(
      `${JSON.stringify({
        entry: 'src/index.ts',
        options: {
          '--': [],
          type: 'bun',
          name: 'Tommy',
          minify: true,
        },
        nodeEnv: process.env.NODE_ENV,
      })}\n`,
    )
  })

  test('many-commands README example runs root and nested commands', async () => {
    const stdout = createTestOutputStream()
    const cli = gokeTestable('deploy', { stdout })

    cli
      .command('', 'Deploy the current project')
      .option('--env <env>', z.string().default('production').describe('Target environment'))
      .option('--dry-run', 'Preview without deploying')
      .action((options, { console, process }) => {
        console.log(`Deploying to ${options.env} from ${process.cwd} dryRun=${String(options.dryRun)}`)
      })

    cli
      .command('logs <deploymentId>', 'Stream logs for a deployment')
      .option('--follow', 'Follow log output')
      .option('--lines <n>', z.number().default(100).describe('Number of lines'))
      .action((deploymentId, options, { console, process }) => {
        console.log(
          `Streaming logs for ${deploymentId} from ${process.cwd} follow=${String(options.follow)} lines=${options.lines}`,
        )
      })

    cli.parse(['node', 'bin', '--env', 'staging', '--dry-run'], { run: false })
    await cli.runMatchedCommand()

    expect(stdout.text).toBe(
      `Deploying to staging from ${process.cwd()} dryRun=true\n`,
    )

    stdout.lines.length = 0

    cli.parse(['node', 'bin', 'logs', 'abc123', '--follow'], { run: false })
    await cli.runMatchedCommand()

    expect(stdout.text).toBe(
      `Streaming logs for abc123 from ${process.cwd()} follow=true lines=100\n`,
    )
  })
})

describe('documented command APIs', () => {
  test('alias runs the same command through a short name', () => {
    const cli = gokeTestable('mycli')
    let seen = ''

    cli.command('install', 'Install packages').alias('i').action(() => {
      seen = 'install'
    })

    cli.parse(['node', 'bin', 'i'], { run: true })

    expect(seen).toBe('install')
  })

  test('command helpText returns command-specific help without printing', () => {
    const stdout = createTestOutputStream()
    const cli = goke('mycli', { stdout })

    const command = cli
      .command('deploy <env>', 'Deploy to an environment')
      .option('--dry-run', 'Preview without deploying')
      .example('# Deploy safely first')
      .example('mycli deploy staging --dry-run')

    cli.help()

    const help = stripAnsi(command.helpText())

    expect(help).toContain('$ mycli deploy <env>')
    expect(help).toContain('--dry-run')
    expect(help).toContain('Deploy safely first')
    expect(stdout.text).toBe('')
  })

  test('openInBrowser prints the URL to stdout in non-tty environments', () => {
    const url = 'https://example.com/dashboard'
    const originalStdoutWrite = process.stdout.write
    const originalStderrWrite = process.stderr.write
    const originalIsTTY = process.stdout.isTTY
    let stdout = ''
    let stderr = ''

    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: false,
    })
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += String(chunk)
      return true
    }) as typeof process.stdout.write
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr += String(chunk)
      return true
    }) as typeof process.stderr.write

    try {
      openInBrowser(url)
    } finally {
      process.stdout.write = originalStdoutWrite
      process.stderr.write = originalStderrWrite
      Object.defineProperty(process.stdout, 'isTTY', {
        configurable: true,
        value: originalIsTTY,
      })
    }

    expect(stdout).toBe(`${url}\n`)
    expect(stderr).toBe('')
  })
})

describe('generateDocs', () => {
  test('generates pages for CLI with multiple commands', () => {
    const cli = gokeTestable('sentry')
      .version('1.0.0')
      .help()

    cli
      .command('event view <id>', 'View details of a specific event')
      .option('-w, --web', 'Open in browser')
      .option('--spans <spans>', z.string().default('3').describe('Span tree depth limit'))
      .example('```\nsentry event view abc123\n```')

    cli
      .command('event list <issue>', 'List events for an issue')
      .option('-n, --limit <limit>', z.number().default(25).describe('Number of events'))
      .option('-q, --query <query>', 'Search query')

    cli
      .command('hidden-cmd', 'Should not appear')
      .hidden()

    const pages = generateDocs({ cli })

    expect(pages.map((p) => p.slug)).toMatchInlineSnapshot(`
      [
        "index",
        "event-view",
        "event-list",
      ]
    `)

    // Index page
    expect(pages[0].content).toMatchInlineSnapshot(`
      "# sentry

      Version: 1.0.0

      ## Commands

      | Command | Description |
      |---------|-------------|
      | [\`event view\`](./event-view.md) | View details of a specific event |
      | [\`event list\`](./event-list.md) | List events for an issue |

      ## Global Options

      | Option | Default | Description |
      |--------|---------|-------------|
      | \`-v, --version\` | - | Display version number |
      | \`-h, --help\` | - | Display this message |
      "
    `)

    // Command page with examples
    expect(pages[1].content).toMatchInlineSnapshot(`
      "# event view

      View details of a specific event

      ## Usage

      \`\`\`sh
      sentry event view <id>
      \`\`\`

      ## Arguments

      | Argument | Required | Description |
      |----------|----------|-------------|
      | \`<id>\` | Yes | id |

      ## Options

      | Option | Default | Description |
      |--------|---------|-------------|
      | \`-w, --web\` | - | Open in browser |
      | \`--spans <spans>\` | \`3\` | Span tree depth limit |

      ## Global Options

      | Option | Default | Description |
      |--------|---------|-------------|
      | \`-v, --version\` | - | Display version number |
      | \`-h, --help\` | - | Display this message |

      ## Examples

      \`\`\`
      sentry event view abc123
      \`\`\`
      "
    `)

    // Command page without examples
    expect(pages[2].content).toMatchInlineSnapshot(`
      "# event list

      List events for an issue

      ## Usage

      \`\`\`sh
      sentry event list <issue>
      \`\`\`

      ## Arguments

      | Argument | Required | Description |
      |----------|----------|-------------|
      | \`<issue>\` | Yes | issue |

      ## Options

      | Option | Default | Description |
      |--------|---------|-------------|
      | \`-n, --limit <limit>\` | \`25\` | Number of events |
      | \`-q, --query <query>\` | - | Search query |

      ## Global Options

      | Option | Default | Description |
      |--------|---------|-------------|
      | \`-v, --version\` | - | Display version number |
      | \`-h, --help\` | - | Display this message |
      "
    `)
  })

  test('handles CLI with no commands', () => {
    const cli = gokeTestable('empty')
    const pages = generateDocs({ cli })
    expect(pages).toEqual([])
  })

  test('skips deprecated options', () => {
    const cli = gokeTestable('mycli')
    cli
      .command('deploy', 'Deploy the app')
      .option('--force', 'Skip confirmation')
      .option('--old-flag', z.boolean().meta({ deprecated: true }).describe('Use --force instead'))

    const pages = generateDocs({ cli })
    const deployPage = pages.find((p) => p.slug === 'deploy')!
    // The deprecated option should not appear
    expect(deployPage.content).not.toContain('old-flag')
  })
})
