/**
 * Tests for injected execution context, clone isolation, and the JustBash bridge.
 */

import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import goke from '../index.js'
import type { GokeOutputStream, GokeOptions, GokeFs } from '../index.js'

/**
 * Build a minimal `GokeFs` stub where every method throws unless the
 * caller overrides it. Used by `createExecutionContext` tests that
 * only care about a single method (e.g. `readFile`) but still need
 * an object that satisfies the full `GokeFs` interface.
 */
function stubGokeFs(overrides: Partial<GokeFs>): GokeFs {
  const notImplemented = () => { throw new Error('not implemented in stub') }
  return {
    appendFile: notImplemented,
    chmod: notImplemented,
    copyFile: notImplemented,
    link: notImplemented,
    mkdir: notImplemented,
    readFile: notImplemented,
    readlink: notImplemented,
    realpath: notImplemented,
    rename: notImplemented,
    rm: notImplemented,
    symlink: notImplemented,
    utimes: notImplemented,
    writeFile: notImplemented,
    ...overrides,
  }
}

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
  test('command action receives injected console and process', async () => {
    const stdout = createTestOutputStream()
    const cli = gokeTestable('mycli', { stdout })
    let seenArgv: string[] | undefined

    cli
      .command('status', 'Show status')
      .action((options, { console, process }) => {
        console.log('ready')
        seenArgv = process.argv
      })

    await cli.parse(['node', 'bin', 'status'], { run: true })

    expect(stdout.text).toBe('ready\n')
    expect(seenArgv).toEqual(['node', 'bin', 'status'])
  })

  test('middleware receives injected console and process', async () => {
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

    await cli.parse(['node', 'bin', 'build'], { run: true })

    expect(stdout.text).toBe('middleware\n')
    expect(seenArgv).toEqual(['node', 'bin', 'build'])
  })
})

describe('clone', () => {
  test('clone creates isolated parse state', async () => {
    const cli = gokeTestable('mycli')

    cli.command('build', 'Build').action(() => {})

    const cloned = cli.clone({ exit: () => {} })

    await cloned.parse(['node', 'bin', 'build'], { run: false })

    expect(cloned).not.toBe(cli)
    expect(cloned.matchedCommandName).toBe('build')
    expect(cli.matchedCommandName).toBeUndefined()
  })
})

describe('createExecutionContext', () => {
  test('returns a context that mirrors the cli defaults when called with no override', async () => {
    const stdout = createTestOutputStream()
    const stderr = createTestOutputStream()
    const cli = gokeTestable('mycli', {
      cwd: '/workspace',
      env: { TOKEN: 'abc' },
      stdin: 'stdin-text',
      stdout,
      stderr,
    })

    const ctx = cli.createExecutionContext()

    expect(ctx.process.cwd).toBe('/workspace')
    expect(ctx.process.env.TOKEN).toBe('abc')
    expect(ctx.process.stdin).toBe('stdin-text')
    expect(ctx.process.stdout).toBe(stdout)
    expect(ctx.process.stderr).toBe(stderr)

    ctx.console.log('hi')
    expect(stdout.text).toBe('hi\n')
  })

  test('honors per-call overrides for stdout, cwd, env, stdin, fs, and exit', async () => {
    const defaultStdout = createTestOutputStream()
    const defaultFs = stubGokeFs({ readFile: async () => 'default' })
    const cli = gokeTestable('mycli', {
      cwd: '/default',
      env: { DEFAULT: '1' },
      stdin: 'default-stdin',
      stdout: defaultStdout,
      fs: defaultFs,
    })

    const overrideStdout = createTestOutputStream()
    const overrideStderr = createTestOutputStream()
    const overrideFs = stubGokeFs({ readFile: async () => 'override' })
    let receivedExitCode: number | undefined
    const ctx = cli.createExecutionContext({
      cwd: '/tenant',
      env: { TOKEN: 'xyz' },
      stdin: 'tenant-stdin',
      stdout: overrideStdout,
      stderr: overrideStderr,
      fs: overrideFs,
      exit: (code) => {
        receivedExitCode = code
      },
    })

    expect(ctx.process.cwd).toBe('/tenant')
    expect(ctx.process.env.TOKEN).toBe('xyz')
    expect(ctx.process.env.DEFAULT).toBeUndefined()
    expect(ctx.process.stdin).toBe('tenant-stdin')
    expect(ctx.process.stdout).toBe(overrideStdout)
    expect(ctx.process.stderr).toBe(overrideStderr)
    expect(ctx.fs).toBe(overrideFs)
    expect(await ctx.fs.readFile('unused')).toBe('override')

    // The cli's own stdout must NOT receive writes made through the
    // override. This is what makes per-request capturing safe.
    ctx.console.log('per-tenant')
    expect(defaultStdout.text).toBe('')
    expect(overrideStdout.text).toBe('per-tenant\n')

    // Custom exit callback runs, then the wrapper throws GokeProcessExit
    // so the action's code path stops at the exit site.
    const { GokeProcessExit } = await import('../goke.js')
    expect(() => ctx.process.exit(7)).toThrow(GokeProcessExit)
    expect(receivedExitCode).toBe(7)
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

  test('truncates captured output to just-bash maxOutputSize and appends a notice', async () => {
    const { Bash } = await import('just-bash')
    const cli = gokeTestable('parent')

    cli
      .command('spam-stderr', 'Write too much stderr')
      .action((options, { console }) => {
        console.error('x'.repeat(60))
        console.error('y'.repeat(60))
      })

    const bash = new Bash({
      executionLimits: { maxOutputSize: 80 },
      customCommands: [await cli.createJustBashCommand()],
    })

    const result = await bash.exec('parent spam-stderr')

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr.length).toBeLessThanOrEqual(80)
    expect(result.stderr).toBe(`${'x'.repeat(60)}\n[output truncated]\n`)
  })
})
