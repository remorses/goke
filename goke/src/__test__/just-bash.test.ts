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
