/**
 * Tests for injected execution context, clone isolation, and the JustBash bridge.
 */

import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import goke from '../index.js'
import type { GokeOutputStream, GokeOptions } from '../index.js'

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

describe('injected execution context', () => {
  test('command action receives injected console and process', () => {
    const stdout = createTestOutputStream()
    const cli = gokeTestable('mycli', { stdout })
    let seenArgv: string[] | undefined

    cli
      .command('status', 'Show status')
      .action((options, { console, process }) => {
        console.log('ready')
        seenArgv = process.argv
      })

    cli.parse(['node', 'bin', 'status'], { run: true })

    expect(stdout.text).toBe('ready\n')
    expect(seenArgv).toEqual(['node', 'bin', 'status'])
  })

  test('middleware receives injected console and process', () => {
    const stdout = createTestOutputStream()
    const cli = gokeTestable('mycli', { stdout })
    let seenArgv: string[] | undefined

    cli
      .use((options, { console, process }) => {
        console.log('middleware')
        seenArgv = process.argv
      })
      .command('build', 'Build')
      .action(() => {})

    cli.parse(['node', 'bin', 'build'], { run: true })

    expect(stdout.text).toBe('middleware\n')
    expect(seenArgv).toEqual(['node', 'bin', 'build'])
  })
})

describe('clone', () => {
  test('clone creates isolated parse state', () => {
    const cli = gokeTestable('mycli')

    cli.command('build', 'Build').action(() => {})

    const cloned = cli.clone({ exit: () => {} })

    cloned.parse(['node', 'bin', 'build'], { run: false })

    expect(cloned).not.toBe(cli)
    expect(cloned.matchedCommandName).toBe('build')
    expect(cli.matchedCommandName).toBeUndefined()
  })
})

describe('createJustBashCommand', () => {
  test('runs multi-word goke subcommands through one just-bash command', async () => {
    const cli = gokeTestable('parent')

    cli
      .command('child commandwithspaces', 'Run nested command')
      .option('--name <name>', z.string().describe('Name'))
      .action((options, { console }) => {
        console.log(`hello ${options.name}`)
      })

    const customCommand = await cli.createJustBashCommand()
    const result = await customCommand.execute(['child', 'commandwithspaces', '--name', 'Tommy'])

    expect(result).toEqual({
      stdout: 'hello Tommy\n',
      stderr: '',
      exitCode: 0,
    })
  })

  test('works through real just-bash exec with a goke custom command', async () => {
    const { Bash } = await import('just-bash')
    const cli = gokeTestable('parent')

    cli
      .command('child commandwithspaces', 'Run nested command')
      .option('--name <name>', z.string().describe('Name'))
      .action((options, { console }) => {
        console.log(`hello ${options.name}`)
      })

    const bash = new Bash({
      customCommands: [await cli.createJustBashCommand()],
    })

    const result = await bash.exec('parent child commandwithspaces --name Tommy')

    expect(result.stdout).toBe('hello Tommy\n')
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
  })

  test('maps injected fs to the just-bash virtual filesystem', async () => {
    const { Bash } = await import('just-bash')
    const cli = gokeTestable('parent')

    cli
      .command('login', 'Persist login state')
      .option('--token <token>', z.string().describe('Token'))
      .action(async (options, { fs, console }) => {
        await fs.mkdir('.mycli', { recursive: true })
        await fs.writeFile('.mycli/auth.json', JSON.stringify({ token: options.token }), 'utf8')
        console.log('saved credentials')
      })

    const bash = new Bash({
      customCommands: [await cli.createJustBashCommand()],
    })

    const loginResult = await bash.exec('mkdir project && cd project && parent login --token Tommy')
    const catResult = await bash.exec('cd project && cat .mycli/auth.json')

    expect(loginResult.stdout).toBe('saved credentials\n')
    expect(loginResult.stderr).toBe('')
    expect(loginResult.exitCode).toBe(0)
    expect(catResult.stdout).toBe('{"token":"Tommy"}')
    expect(catResult.stderr).toBe('')
    expect(catResult.exitCode).toBe(0)
  })

  test('real just-bash exec passes the configured in-memory fs to the goke command', async () => {
    const { Bash, InMemoryFs } = await import('just-bash')
    const cli = gokeTestable('parent')

    cli
      .command('login', 'Persist login state')
      .option('--token <token>', z.string().describe('Token'))
      .action(async (options, { fs, console }) => {
        await fs.mkdir('.mycli', { recursive: true })
        await fs.writeFile('.mycli/auth.json', JSON.stringify({ token: options.token }), 'utf8')
        console.log('saved credentials')
      })

    const virtualFs = new InMemoryFs()
    await virtualFs.mkdir('/project', { recursive: true })

    const bash = new Bash({
      fs: virtualFs,
      cwd: '/project',
      customCommands: [await cli.createJustBashCommand()],
    })

    const result = await bash.exec('parent login --token Tommy')

    expect(result.stdout).toBe('saved credentials\n')
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(await virtualFs.readFile('/project/.mycli/auth.json', 'utf8')).toBe('{"token":"Tommy"}')
  })

  test('real just-bash exec passes sandbox cwd, stdin, and env through process context', async () => {
    const { Bash, InMemoryFs } = await import('just-bash')
    const cli = gokeTestable('parent')

    cli
      .command('context', 'Inspect process context')
      .action((options, { console, process }) => {
        console.log(JSON.stringify({
          cwd: process.cwd,
          stdin: process.stdin,
          token: process.env.TOKEN,
        }))
      })

    const virtualFs = new InMemoryFs()
    await virtualFs.mkdir('/project', { recursive: true })

    const bash = new Bash({
      fs: virtualFs,
      cwd: '/project',
      env: { TOKEN: 'Tommy' },
      customCommands: [await cli.createJustBashCommand()],
    })

    const result = await bash.exec('parent context', { stdin: 'hello from stdin' })

    expect(result.stdout).toBe(
      `${JSON.stringify({ cwd: '/project', stdin: 'hello from stdin', token: 'Tommy' })}\n`,
    )
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
  })

  test('explicit just-bash context exposes a mutable env object backed by the sandbox env', async () => {
    const { InMemoryFs } = await import('just-bash')
    const cli = gokeTestable('parent')

    cli
      .command('mutate-env', 'Mutate sandbox env')
      .action((options, { console, process }) => {
        process.env.TOKEN = 'updated'
        console.log(process.env.TOKEN)
      })

    const virtualFs = new InMemoryFs()
    await virtualFs.mkdir('/project', { recursive: true })
    const env = new Map<string, string>([['TOKEN', 'before']])
    const customCommand = await cli.createJustBashCommand()

    const result = await customCommand.execute(
      ['mutate-env'],
      { fs: virtualFs, cwd: '/project', env, stdin: '' },
    )

    expect(result.stdout).toBe('updated\n')
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(env.get('TOKEN')).toBe('updated')
  })

  test('accepts an explicit just-bash fs context when executing the custom command', async () => {
    const { InMemoryFs } = await import('just-bash')
    const cli = gokeTestable('parent')

    cli
      .command('login', 'Persist login state')
      .option('--token <token>', z.string().describe('Token'))
      .action(async (options, { fs, console }) => {
        await fs.mkdir('.mycli', { recursive: true })
        await fs.writeFile('.mycli/auth.json', JSON.stringify({ token: options.token }), 'utf8')
        console.log('saved credentials')
      })

    const customCommand = await cli.createJustBashCommand()
    const virtualFs = new InMemoryFs()
    await virtualFs.mkdir('/project', { recursive: true })

    const result = await customCommand.execute(
      ['login', '--token', 'Tommy'],
      { fs: virtualFs, cwd: '/project', env: new Map(), stdin: '' },
    )

    expect(result.stdout).toBe('saved credentials\n')
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(await virtualFs.readFile('/project/.mycli/auth.json', 'utf8')).toBe('{"token":"Tommy"}')
  })

  test('maps injected process.exit to a command exit code', async () => {
    const cli = gokeTestable('parent')

    cli
      .command('fail', 'Exit with custom code')
      .action((options, { process }) => {
        process.exit(7)
      })

    const customCommand = await cli.createJustBashCommand()
    const result = await customCommand.execute(['fail'])

    expect(result).toEqual({
      stdout: '',
      stderr: '',
      exitCode: 7,
    })
  })
})
