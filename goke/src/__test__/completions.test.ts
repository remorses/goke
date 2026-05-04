/**
 * Tests for shell completion support.
 *
 * Tests the getCompletions() method (which computes completions for given args),
 * the --get-goke-completions flag interception in parse(), the script generation,
 * and the completions install/uninstall/script commands.
 */

import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import goke from '../index.js'
import { generateCompletionScript } from '../index.js'
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

function buildTestCli(stdout?: GokeOutputStream) {
  const out = stdout ?? createTestOutputStream()
  const cli = gokeTestable('mycli', { stdout: out })
    .help()
    .completions()

  cli.command('deploy', 'Deploy the app')
    .option('--env <env>', z.enum(['staging', 'production']).describe('Target environment'))
    .option('--dry-run', 'Preview without deploying')

  cli.command('deploy rollback', 'Rollback a deployment')
    .option('--to <version>', 'Target version')

  cli.command('logs <deploymentId>', 'Stream deployment logs')
    .option('--lines <n>', z.number().default(100).describe('Lines to tail'))

  cli.command('status', 'Show current status')

  cli.command('internal-debug', 'Debug command')
    .hidden()

  return { cli, stdout: out as GokeOutputStream & { lines: string[]; text: string } }
}

describe('getCompletions', () => {
  let originalShell: string | undefined

  beforeEach(() => {
    originalShell = process.env.SHELL
  })

  afterEach(() => {
    if (originalShell !== undefined) {
      process.env.SHELL = originalShell
    } else {
      delete process.env.SHELL
    }
  })

  test('returns all visible commands when current word is empty', () => {
    process.env.SHELL = '/bin/bash'
    const { cli } = buildTestCli()
    const completions = cli.getCompletions(['mycli', ''])

    expect(completions).toMatchInlineSnapshot(`
      [
        "deploy",
        "logs",
        "status",
        "completions",
      ]
    `)
  })

  test('hidden commands are excluded', () => {
    process.env.SHELL = '/bin/bash'
    const { cli } = buildTestCli()
    const completions = cli.getCompletions(['mycli', ''])

    expect(completions).not.toContain('internal-debug')
  })

  test('filters commands by prefix', () => {
    process.env.SHELL = '/bin/bash'
    const { cli } = buildTestCli()
    const completions = cli.getCompletions(['mycli', 'dep'])

    expect(completions).toMatchInlineSnapshot(`
      [
        "deploy",
      ]
    `)
  })

  test('suggests options after matched command', () => {
    process.env.SHELL = '/bin/bash'
    const { cli } = buildTestCli()
    const completions = cli.getCompletions(['mycli', 'deploy', '--'])

    expect(completions).toContain('--env')
    expect(completions).toContain('--dry-run')
    expect(completions).toContain('--help')
  })

  test('suggests subcommands after matched command prefix', () => {
    process.env.SHELL = '/bin/bash'
    const { cli } = buildTestCli()
    const completions = cli.getCompletions(['mycli', 'deploy', ''])

    expect(completions).toContain('rollback')
  })

  test('includes descriptions in zsh format', () => {
    process.env.SHELL = '/bin/zsh'
    const { cli } = buildTestCli()
    const completions = cli.getCompletions(['mycli', ''])

    // zsh format is name:description
    expect(completions.some((c) => c.includes(':Deploy the app'))).toBe(true)
    expect(completions.some((c) => c.includes(':Stream deployment logs'))).toBe(true)
  })

  test('zsh option completions include descriptions', () => {
    process.env.SHELL = '/bin/zsh'
    const { cli } = buildTestCli()
    const completions = cli.getCompletions(['mycli', 'deploy', '--'])

    expect(completions.some((c) => c.includes('--env:Target environment'))).toBe(true)
    expect(completions.some((c) => c.includes('--dry-run:Preview without deploying'))).toBe(true)
  })

  test('filters options by prefix', () => {
    process.env.SHELL = '/bin/bash'
    const { cli } = buildTestCli()
    const completions = cli.getCompletions(['mycli', 'deploy', '--dr'])

    expect(completions).toMatchInlineSnapshot(`
      [
        "--dry-run",
      ]
    `)
  })

  test('suggests global options at root level', () => {
    process.env.SHELL = '/bin/bash'
    const { cli } = buildTestCli()
    const completions = cli.getCompletions(['mycli', '--'])

    expect(completions).toContain('--help')
  })

  test('multi-word command completion', () => {
    process.env.SHELL = '/bin/bash'
    const { cli } = buildTestCli()
    // User typed "mycli deploy " and hits tab
    const completions = cli.getCompletions(['mycli', 'deploy', 'roll'])

    expect(completions).toMatchInlineSnapshot(`
      [
        "rollback",
      ]
    `)
  })
})

describe('--get-goke-completions flag in parse()', () => {
  test('prints completions to stdout and exits', () => {
    const stdout = createTestOutputStream()
    const { cli } = buildTestCli(stdout)

    // Simulate: mycli --get-goke-completions mycli dep
    cli.parse(['node', 'bin', '--get-goke-completions', 'mycli', 'dep'])

    // Should have printed completions to stdout
    expect(stdout.text).toContain('deploy')
  })

  test('does not run any command action', () => {
    const stdout = createTestOutputStream()
    const actionSpy = vi.fn()
    const cli = gokeTestable('mycli', { stdout })
      .completions()
    cli.command('deploy', 'Deploy').action(actionSpy)

    cli.parse(['node', 'bin', '--get-goke-completions', 'mycli', 'deploy', ''])

    expect(actionSpy).not.toHaveBeenCalled()
  })
})

describe('generateCompletionScript', () => {
  test('zsh template has #compdef header', () => {
    const script = generateCompletionScript('zsh', 'my-cli', '/usr/local/bin/my-cli')

    expect(script).toContain('#compdef my-cli')
    expect(script).toContain('--get-goke-completions')
    expect(script).toContain('/usr/local/bin/my-cli')
    expect(script).toContain('_my_cli_completions')
  })

  test('bash template has complete command', () => {
    const script = generateCompletionScript('bash', 'my-cli', '/usr/local/bin/my-cli')

    expect(script).toContain('complete -o bashdefault')
    expect(script).toContain('--get-goke-completions')
    expect(script).toContain('/usr/local/bin/my-cli')
    expect(script).toContain('_my_cli_completions')
  })

  test('uses cliName as fallback path when cliPath not provided', () => {
    const script = generateCompletionScript('zsh', 'my-cli')

    expect(script).toContain('my-cli --get-goke-completions')
  })

  test('escapes special characters in function names', () => {
    const script = generateCompletionScript('zsh', 'my-cli.js', './my-cli.js')

    // Function name should use underscores
    expect(script).toContain('_my_cli_js_completions')
    // But app_name (for compdef) should stay as-is
    expect(script).toContain('#compdef my-cli.js')
  })
})

describe('completions commands', () => {
  test('completions script prints zsh script', () => {
    process.env.SHELL = '/bin/zsh'
    const stdout = createTestOutputStream()
    const cli = gokeTestable('mycli', { stdout })
      .completions()

    cli.parse(['node', 'bin', 'completions', 'script'])

    expect(stdout.text).toContain('#compdef mycli')
    expect(stdout.text).toContain('--get-goke-completions')
  })

  test('completions script prints bash script with --shell', () => {
    const stdout = createTestOutputStream()
    const cli = gokeTestable('mycli', { stdout })
      .completions()

    cli.parse(['node', 'bin', 'completions', 'script', '--shell', 'bash'])

    expect(stdout.text).toContain('complete -o bashdefault')
    expect(stdout.text).toContain('--get-goke-completions')
  })

  test('completions script rejects invalid shell value', async () => {
    const stderr = createTestOutputStream()
    const cli = gokeTestable('mycli', { stderr })
      .completions()

    cli.parse(['node', 'bin', 'completions', 'script', '--shell', 'fish'])
    // The error is caught by handleCliError and printed to stderr
    // Wait a tick for the sync action to complete
    await new Promise((r) => setTimeout(r, 10))
    expect(stderr.text).toContain('Invalid shell "fish"')
  })
})

describe('GOKE_COMPLETION_SHELL env var', () => {
  let originalShell: string | undefined
  let originalCompletionShell: string | undefined

  beforeEach(() => {
    originalShell = process.env.SHELL
    originalCompletionShell = process.env.GOKE_COMPLETION_SHELL
  })

  afterEach(() => {
    if (originalShell !== undefined) process.env.SHELL = originalShell
    else delete process.env.SHELL
    if (originalCompletionShell !== undefined) process.env.GOKE_COMPLETION_SHELL = originalCompletionShell
    else delete process.env.GOKE_COMPLETION_SHELL
  })

  test('uses GOKE_COMPLETION_SHELL over SHELL for format detection', () => {
    // Login shell is zsh but the bash shim sets GOKE_COMPLETION_SHELL=bash
    process.env.SHELL = '/bin/zsh'
    process.env.GOKE_COMPLETION_SHELL = 'bash'
    const { cli } = buildTestCli()
    const completions = cli.getCompletions(['mycli', ''])

    // Should NOT include :description format (that's zsh-only)
    for (const c of completions) {
      expect(c).not.toContain(':')
    }
  })

  test('zsh template sets GOKE_COMPLETION_SHELL=zsh', () => {
    const script = generateCompletionScript('zsh', 'mycli')
    expect(script).toContain('GOKE_COMPLETION_SHELL=zsh')
  })

  test('bash template sets GOKE_COMPLETION_SHELL=bash', () => {
    const script = generateCompletionScript('bash', 'mycli')
    expect(script).toContain('GOKE_COMPLETION_SHELL=bash')
  })
})

describe('option value position', () => {
  let originalShell: string | undefined

  beforeEach(() => {
    originalShell = process.env.SHELL
    process.env.SHELL = '/bin/bash'
    delete process.env.GOKE_COMPLETION_SHELL
  })

  afterEach(() => {
    if (originalShell !== undefined) process.env.SHELL = originalShell
    else delete process.env.SHELL
  })

  test('returns empty when previous token is a value-taking option', () => {
    const { cli } = buildTestCli()
    // mycli deploy --env <TAB> — should not suggest flags
    const completions = cli.getCompletions(['mycli', 'deploy', '--env', ''])

    expect(completions).toEqual([])
  })

  test('still suggests flags when previous token is a boolean option', () => {
    const { cli } = buildTestCli()
    // mycli deploy --dry-run <TAB> — boolean flag, should still suggest
    const completions = cli.getCompletions(['mycli', 'deploy', '--dry-run', '--'])

    expect(completions).toContain('--env')
  })
})

describe('default command options', () => {
  let originalShell: string | undefined

  beforeEach(() => {
    originalShell = process.env.SHELL
    process.env.SHELL = '/bin/bash'
    delete process.env.GOKE_COMPLETION_SHELL
  })

  afterEach(() => {
    if (originalShell !== undefined) process.env.SHELL = originalShell
    else delete process.env.SHELL
  })

  test('includes default command options at root level', () => {
    const cli = gokeTestable('mycli')
      .help()
      .completions()

    cli.command('', 'Default action')
      .option('--env <env>', 'Target environment')
      .option('--dry-run', 'Preview')

    const completions = cli.getCompletions(['mycli', '--'])

    expect(completions).toContain('--env')
    expect(completions).toContain('--dry-run')
    expect(completions).toContain('--help')
  })
})

describe('alias suppression', () => {
  let originalShell: string | undefined

  beforeEach(() => {
    originalShell = process.env.SHELL
    process.env.SHELL = '/bin/bash'
    delete process.env.GOKE_COMPLETION_SHELL
  })

  afterEach(() => {
    if (originalShell !== undefined) process.env.SHELL = originalShell
    else delete process.env.SHELL
  })

  test('suppresses --dry-run when -d alias was already used', () => {
    const cli = gokeTestable('mycli')
      .completions()

    cli.command('deploy', 'Deploy')
      .option('-d, --dry-run', 'Preview')
      .option('--env <env>', 'Environment')

    const completions = cli.getCompletions(['mycli', 'deploy', '-d', '--'])

    expect(completions).not.toContain('--dry-run')
    expect(completions).toContain('--env')
  })
})
