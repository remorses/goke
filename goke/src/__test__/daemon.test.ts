/**
 * Tests for the daemon background process support.
 *
 * Tests the DaemonContext lifecycle: PID file management, isDaemon detection,
 * start/stop/isRunning, forCommand, heartbeat, and instance ID safety.
 *
 * Server-mode tests (isDaemon=true) run in child processes to avoid
 * scheduling process.exit() timers inside the vitest runner.
 */

import { describe, expect, test, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const execFileAsync = promisify(execFile)

const DAEMON_DIR = path.join(os.homedir(), '.config', 'goke', 'daemons')

function pidFilePath(cliName: string, commandName: string): string {
  const safeName = `${cliName}--${commandName}`
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '')
  return path.join(DAEMON_DIR, `${safeName}.pid.json`)
}

function readPidFile(filePath: string): { pid: number; id: string; startedAt: number; heartbeatAt: number } | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function killIfAlive(pid: number): Promise<void> {
  if (isProcessAlive(pid)) {
    try { process.kill(pid, 'SIGKILL') } catch {}
  }
}

// Track PIDs to clean up after tests
const spawnedPids: number[] = []
const testPidFiles: string[] = []

afterEach(async () => {
  for (const pid of spawnedPids) {
    await killIfAlive(pid)
  }
  spawnedPids.length = 0

  for (const f of testPidFiles) {
    try { fs.unlinkSync(f) } catch {}
  }
  testPidFiles.length = 0
})

// Helper script that simulates a daemon process: writes PID file with
// instance ID and heartbeat, stays alive until SIGTERM or timeout.
function writeDaemonHelper(scriptPath: string): void {
  fs.writeFileSync(scriptPath, `
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

const DAEMON_DIR = path.join(os.homedir(), '.config', 'goke', 'daemons')
const cliName = process.env.TEST_CLI_NAME || 'test-daemon-cli'
const cmdName = process.env.TEST_CMD_NAME || 'bg'
const safeName = cliName + '--' + cmdName
const pidFile = path.join(DAEMON_DIR, safeName + '.pid.json')

fs.mkdirSync(path.dirname(pidFile), { recursive: true })

const instanceId = crypto.randomBytes(8).toString('hex')
const pidData = { pid: process.pid, id: instanceId, startedAt: Date.now(), heartbeatAt: Date.now() }
fs.writeFileSync(pidFile, JSON.stringify(pidData), { mode: 0o600 })

const hb = setInterval(() => {
  try {
    const current = JSON.parse(fs.readFileSync(pidFile, 'utf-8'))
    if (current.id === instanceId) {
      current.heartbeatAt = Date.now()
      fs.writeFileSync(pidFile, JSON.stringify(current), { mode: 0o600 })
    }
  } catch {}
}, 2000)
hb.unref()

const timeoutMs = Number(process.env.GOKE_DAEMON_TIMEOUT) || 60000
const timer = setTimeout(() => {
  try {
    const current = JSON.parse(fs.readFileSync(pidFile, 'utf-8'))
    if (current.id === instanceId) fs.unlinkSync(pidFile)
  } catch {}
  process.exit(0)
}, timeoutMs)

process.on('SIGTERM', () => {
  clearTimeout(timer)
  clearInterval(hb)
  try {
    const current = JSON.parse(fs.readFileSync(pidFile, 'utf-8'))
    if (current.id === instanceId) fs.unlinkSync(pidFile)
  } catch {}
  process.exit(0)
})

process.on('exit', () => {
  try {
    const current = JSON.parse(fs.readFileSync(pidFile, 'utf-8'))
    if (current.id === instanceId) fs.unlinkSync(pidFile)
  } catch {}
})
`)
}

describe('DaemonContext', () => {
  test('isDaemon is false by default (client mode)', async () => {
    const { default: goke } = await import('../index.js')
    const cli = goke('test-cli')
    let isDaemon: boolean | undefined

    cli.command('run', 'test').action((opts, ctx) => {
      isDaemon = ctx.daemon.isDaemon
    })

    await cli.parse(['node', 'test', 'run'], { run: true })
    expect(isDaemon).toBe(false)
  })

  test('isDaemon is true when GOKE_DAEMON=1 (tested in child process)', async () => {
    // Run a small script in a child process that creates a DaemonContext
    // with the env var set and prints isDaemon. This avoids scheduling
    // process.exit() timers inside the vitest process.
    // Uses the compiled dist/ so plain Node can import it (no tsx needed).
    const scriptPath = path.join(os.tmpdir(), 'goke-daemon-is-daemon-test.mjs')
    const distDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'dist')
    fs.writeFileSync(scriptPath, `
import { DaemonContext } from '${distDir}/daemon.js'
const ctx = new DaemonContext({ cliName: 'test-is-daemon', commandName: 'cmd', argv: ['node', 'test'] })
console.log(ctx.isDaemon ? 'SERVER' : 'CLIENT')
// Exit immediately to not leave the daemon alive
process.exit(0)
`)
    testPidFiles.push(pidFilePath('test-is-daemon', 'cmd'))

    const { stdout } = await execFileAsync(process.execPath, [scriptPath], {
      env: { ...process.env, GOKE_DAEMON: '1', GOKE_DAEMON_TIMEOUT: '1000' },
    })
    expect(stdout.trim()).toBe('SERVER')
  }, 10_000)

  test('isRunning returns false when no daemon is running', async () => {
    const { default: goke } = await import('../index.js')
    const cli = goke('test-cli')
    let running: boolean | undefined

    cli.command('check', 'test').action(async (opts, ctx) => {
      running = await ctx.daemon.isRunning()
    })

    await cli.parse(['node', 'test', 'check'], { run: true })
    expect(running).toBe(false)
  })

  test('start spawns a detached daemon, isRunning returns true, stop kills it', async () => {
    const helperScript = path.join(os.tmpdir(), 'goke-daemon-test-start.mjs')
    writeDaemonHelper(helperScript)
    testPidFiles.push(pidFilePath('test-daemon-cli', 'bg'))

    const { DaemonContext } = await import('../daemon.js')
    const ctx = new DaemonContext({
      cliName: 'test-daemon-cli',
      commandName: 'bg',
      argv: [process.execPath, helperScript, 'bg'],
    })

    expect(ctx.isDaemon).toBe(false)
    expect(await ctx.isRunning()).toBe(false)

    await ctx.start({ timeoutMs: 30_000 })
    expect(await ctx.isRunning()).toBe(true)

    const pidData = readPidFile(pidFilePath('test-daemon-cli', 'bg'))
    expect(pidData).not.toBeNull()
    expect(pidData!.id).toBeTruthy()
    spawnedPids.push(pidData!.pid)

    await ctx.stop()
    await new Promise((r) => setTimeout(r, 200))
    expect(await ctx.isRunning()).toBe(false)

    try { fs.unlinkSync(helperScript) } catch {}
  }, 15_000)

  test('start kills existing daemon before spawning new one', async () => {
    const helperScript = path.join(os.tmpdir(), 'goke-daemon-test-replace.mjs')
    writeDaemonHelper(helperScript)
    testPidFiles.push(pidFilePath('test-daemon-cli', 'bg'))

    const { DaemonContext } = await import('../daemon.js')
    const ctx = new DaemonContext({
      cliName: 'test-daemon-cli',
      commandName: 'bg',
      argv: [process.execPath, helperScript, 'bg'],
    })

    await ctx.start({ timeoutMs: 30_000 })
    const firstPid = readPidFile(pidFilePath('test-daemon-cli', 'bg'))
    expect(firstPid).not.toBeNull()
    spawnedPids.push(firstPid!.pid)
    const firstId = firstPid!.id

    await ctx.start({ timeoutMs: 30_000 })
    const secondPid = readPidFile(pidFilePath('test-daemon-cli', 'bg'))
    expect(secondPid).not.toBeNull()
    spawnedPids.push(secondPid!.pid)

    // PIDs and instance IDs should differ
    expect(secondPid!.pid).not.toBe(firstPid!.pid)
    expect(secondPid!.id).not.toBe(firstId)

    expect(isProcessAlive(firstPid!.pid)).toBe(false)
    expect(isProcessAlive(secondPid!.pid)).toBe(true)

    await ctx.stop()
    try { fs.unlinkSync(helperScript) } catch {}
  }, 15_000)

  test('stop is idempotent when no daemon running', async () => {
    const { DaemonContext } = await import('../daemon.js')
    const ctx = new DaemonContext({ cliName: 'nonexistent-cli', commandName: 'nope', argv: ['node', 'nope'] })
    await ctx.stop()
    await ctx.stop()
  })

  test('forCommand returns context for a different command', async () => {
    const { DaemonContext } = await import('../daemon.js')
    const loginCtx = new DaemonContext({ cliName: 'myapp', commandName: 'login', argv: ['node', 'myapp', 'login'] })
    const meCtx = loginCtx.forCommand('me')

    // They should reference different PID files
    expect(await loginCtx.isRunning()).toBe(false)
    expect(await meCtx.isRunning()).toBe(false)

    // forCommand context is always client mode
    expect(meCtx.isDaemon).toBe(false)
  })

  test('forCommand can check and stop another commands daemon', async () => {
    const helperScript = path.join(os.tmpdir(), 'goke-daemon-test-forcommand.mjs')
    writeDaemonHelper(helperScript)
    testPidFiles.push(pidFilePath('test-daemon-cli', 'bg'))

    const { DaemonContext } = await import('../daemon.js')

    // Start daemon for "bg" command
    const bgCtx = new DaemonContext({
      cliName: 'test-daemon-cli',
      commandName: 'bg',
      argv: [process.execPath, helperScript, 'bg'],
    })
    await bgCtx.start({ timeoutMs: 30_000 })

    const pidData = readPidFile(pidFilePath('test-daemon-cli', 'bg'))
    if (pidData) spawnedPids.push(pidData.pid)

    // Create a context for "me" command and use forCommand to check "bg"
    const meCtx = new DaemonContext({ cliName: 'test-daemon-cli', commandName: 'me', argv: ['node', 'test', 'me'] })
    const bgFromMe = meCtx.forCommand('bg')

    expect(await bgFromMe.isRunning()).toBe(true)

    await bgFromMe.stop()
    await new Promise((r) => setTimeout(r, 200))
    expect(await bgFromMe.isRunning()).toBe(false)

    try { fs.unlinkSync(helperScript) } catch {}
  }, 15_000)

  test('stale PID file is cleaned up by isRunning', async () => {
    const pidFile = pidFilePath('stale-test', 'cmd')
    testPidFiles.push(pidFile)

    // Write a PID file with a PID that doesn't exist
    fs.mkdirSync(path.dirname(pidFile), { recursive: true })
    fs.writeFileSync(pidFile, JSON.stringify({
      pid: 999999999,
      id: 'stale-instance',
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    }))

    const { DaemonContext } = await import('../daemon.js')
    const ctx = new DaemonContext({ cliName: 'stale-test', commandName: 'cmd', argv: ['node', 'test'] })

    expect(await ctx.isRunning()).toBe(false)
    // PID file should have been cleaned up
    expect(fs.existsSync(pidFile)).toBe(false)
  })

  test('PID file with stale heartbeat is treated as not running', async () => {
    const pidFile = pidFilePath('heartbeat-test', 'cmd')
    testPidFiles.push(pidFile)

    // Write a PID file with current process PID but very old heartbeat
    fs.mkdirSync(path.dirname(pidFile), { recursive: true })
    fs.writeFileSync(pidFile, JSON.stringify({
      pid: process.pid, // alive PID
      id: 'old-heartbeat',
      startedAt: Date.now() - 60000,
      heartbeatAt: Date.now() - 60000, // 60s old, well past the 15s threshold
    }))

    const { DaemonContext } = await import('../daemon.js')
    const ctx = new DaemonContext({ cliName: 'heartbeat-test', commandName: 'cmd', argv: ['node', 'test'] })

    // Should return false because heartbeat is stale (even though PID is alive)
    expect(await ctx.isRunning()).toBe(false)
  })

  test('start with attach: true pipes stdout/stderr and waits for exit', async () => {
    const helperScript = path.join(os.tmpdir(), 'goke-daemon-test-attach.mjs')
    // This helper writes to stdout/stderr and exits after a short delay.
    // The PID file setup mirrors the standard daemon helper.
    fs.writeFileSync(helperScript, `
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

const DAEMON_DIR = path.join(os.homedir(), '.config', 'goke', 'daemons')
const cliName = process.env.TEST_CLI_NAME || 'test-daemon-cli'
const cmdName = process.env.TEST_CMD_NAME || 'attach-test'
const safeName = cliName + '--' + cmdName
const pidFile = path.join(DAEMON_DIR, safeName + '.pid.json')

fs.mkdirSync(path.dirname(pidFile), { recursive: true })

const instanceId = crypto.randomBytes(8).toString('hex')
const pidData = { pid: process.pid, id: instanceId, startedAt: Date.now(), heartbeatAt: Date.now() }
fs.writeFileSync(pidFile, JSON.stringify(pidData), { mode: 0o600 })

// Write to stdout and stderr so the parent can see it
console.log('DAEMON_STDOUT_MESSAGE')
console.error('DAEMON_STDERR_MESSAGE')

// Exit after a short delay
setTimeout(() => {
  try {
    const current = JSON.parse(fs.readFileSync(pidFile, 'utf-8'))
    if (current.id === instanceId) fs.unlinkSync(pidFile)
  } catch {}
  process.exit(0)
}, 500)
`)
    testPidFiles.push(pidFilePath('test-daemon-cli', 'attach-test'))

    const { DaemonContext } = await import('../daemon.js')
    const ctx = new DaemonContext({
      cliName: 'test-daemon-cli',
      commandName: 'attach-test',
      argv: [process.execPath, helperScript, 'attach-test'],
    })

    // attach: true should wait for the daemon to finish
    await ctx.start({ attach: true, timeoutMs: 10_000 })

    // After start resolves, the daemon should have exited and cleaned up its PID file
    expect(await ctx.isRunning()).toBe(false)

    try { fs.unlinkSync(helperScript) } catch {}
  }, 15_000)

  test('start with attach: true throws on non-zero exit', async () => {
    const helperScript = path.join(os.tmpdir(), 'goke-daemon-test-attach-fail.mjs')
    fs.writeFileSync(helperScript, `
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

const DAEMON_DIR = path.join(os.homedir(), '.config', 'goke', 'daemons')
const cliName = process.env.TEST_CLI_NAME || 'test-daemon-cli'
const cmdName = process.env.TEST_CMD_NAME || 'attach-fail'
const safeName = cliName + '--' + cmdName
const pidFile = path.join(DAEMON_DIR, safeName + '.pid.json')

fs.mkdirSync(path.dirname(pidFile), { recursive: true })

const instanceId = crypto.randomBytes(8).toString('hex')
const pidData = { pid: process.pid, id: instanceId, startedAt: Date.now(), heartbeatAt: Date.now() }
fs.writeFileSync(pidFile, JSON.stringify(pidData), { mode: 0o600 })

console.error('Something went wrong')

setTimeout(() => {
  try {
    const current = JSON.parse(fs.readFileSync(pidFile, 'utf-8'))
    if (current.id === instanceId) fs.unlinkSync(pidFile)
  } catch {}
  process.exit(1)
}, 500)
`)
    testPidFiles.push(pidFilePath('test-daemon-cli', 'attach-fail'))

    const { DaemonContext } = await import('../daemon.js')
    const ctx = new DaemonContext({
      cliName: 'test-daemon-cli',
      commandName: 'attach-fail',
      argv: [process.execPath, helperScript, 'attach-fail'],
    })

    await expect(ctx.start({ attach: true, timeoutMs: 10_000 }))
      .rejects.toThrow('exited with code 1')

    try { fs.unlinkSync(helperScript) } catch {}
  }, 15_000)

  test('detached login returns startup messages and leaves the daemon alive', async () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goke-daemon-login-'))
    const tempDir = path.join(fixtureDir, 'tmp')
    const homeDir = path.join(fixtureDir, 'home')
    const scriptPath = path.join(fixtureDir, 'login.mjs')
    const distEntry = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'dist', 'index.js')
    fs.mkdirSync(tempDir)
    fs.mkdirSync(homeDir)
    fs.writeFileSync(scriptPath, `
import { goke } from ${JSON.stringify(distEntry)}

const cli = goke('agent-login-test')
cli.command('login', 'Authenticate').action(async (_options, ctx) => {
  if (ctx.daemon.isDaemon) {
    ctx.daemon.publishStartupMessage('Preparing authorization')
    await new Promise((resolve) => setTimeout(resolve, 50))
    ctx.daemon.publishStartupMessage('Authorize: https://auth.example.test/oauth?code=agent-123')
    ctx.daemon.publishStartupMessage('Waiting for browser approval', { stream: 'stderr' })
    ctx.daemon.ready()
    setInterval(() => {}, 1000)
    return
  }

  await ctx.daemon.start({ waitForStartup: true, timeoutMs: 30_000 })
})

await cli.parse()
`)

    let daemonPid: number | undefined
    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, 'login'], {
        env: { ...process.env, HOME: homeDir, TMPDIR: tempDir },
        timeout: 10_000,
      })

      expect(stdout).toBe([
        'Preparing authorization',
        'Authorize: https://auth.example.test/oauth?code=agent-123',
        '',
      ].join('\n'))
      expect(stderr).toBe('Waiting for browser approval\n')

      const pidFile = path.join(homeDir, '.config', 'goke', 'daemons', 'agent-login-test--login.pid.json')
      const pidData = readPidFile(pidFile)
      expect(pidData).not.toBeNull()
      daemonPid = pidData!.pid
      expect(isProcessAlive(daemonPid)).toBe(true)
      expect(fs.readdirSync(tempDir)).toEqual([])
    } finally {
      if (daemonPid) await killIfAlive(daemonPid)
      fs.rmSync(fixtureDir, { recursive: true, force: true })
    }
  }, 15_000)

  test('failed startup removes the handoff and stops the daemon', async () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goke-daemon-timeout-'))
    const tempDir = path.join(fixtureDir, 'tmp')
    const homeDir = path.join(fixtureDir, 'home')
    const scriptPath = path.join(fixtureDir, 'timeout.mjs')
    const childPidFile = path.join(fixtureDir, 'child.pid')
    const distEntry = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'dist', 'index.js')
    fs.mkdirSync(tempDir)
    fs.mkdirSync(homeDir)
    fs.writeFileSync(scriptPath, `
import fs from 'node:fs'
import { goke } from ${JSON.stringify(distEntry)}

const cli = goke('startup-timeout-test')
cli.command('login', 'Authenticate').action(async (_options, ctx) => {
  if (ctx.daemon.isDaemon) {
    fs.writeFileSync(process.env.CHILD_PID_FILE, String(process.pid))
    setInterval(() => {}, 1000)
    return
  }

  try {
    await ctx.daemon.start({
      waitForStartup: true,
      startupTimeoutMs: 300,
      timeoutMs: 30_000,
    })
  } catch (error) {
    ctx.console.log(error.message)
  }
})

await cli.parse()
`)

    let childPid: number | undefined
    try {
      const { stdout } = await execFileAsync(process.execPath, [scriptPath, 'login'], {
        env: {
          ...process.env,
          HOME: homeDir,
          TMPDIR: tempDir,
          CHILD_PID_FILE: childPidFile,
        },
        timeout: 10_000,
      })
      childPid = Number(fs.readFileSync(childPidFile, 'utf-8'))
      expect(stdout).toContain('Timed out waiting for daemon startup')
      expect(isProcessAlive(childPid)).toBe(false)
      expect(fs.readdirSync(tempDir)).toEqual([])
      const pidFile = path.join(homeDir, '.config', 'goke', 'daemons', 'startup-timeout-test--login.pid.json')
      expect(fs.existsSync(pidFile)).toBe(false)
    } finally {
      if (childPid) await killIfAlive(childPid)
      fs.rmSync(fixtureDir, { recursive: true, force: true })
    }
  }, 15_000)

  test('daemon context has correct command name from parsed cli', async () => {
    const { default: goke } = await import('../index.js')
    const cli = goke('my-app')
    let capturedDaemon: any

    cli.command('auth login', 'Login').action((opts, ctx) => {
      capturedDaemon = ctx.daemon
    })

    await cli.parse(['node', 'my-app', 'auth', 'login'], { run: true })

    expect(capturedDaemon).toBeDefined()
    expect(capturedDaemon.isDaemon).toBe(false)
  })
})
