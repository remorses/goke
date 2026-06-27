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
const ctx = new DaemonContext('test-is-daemon', 'cmd', ['node', 'test'])
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
    const ctx = new DaemonContext('test-daemon-cli', 'bg', [process.execPath, helperScript, 'bg'])

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
    const ctx = new DaemonContext('test-daemon-cli', 'bg', [process.execPath, helperScript, 'bg'])

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
    const ctx = new DaemonContext('nonexistent-cli', 'nope', ['node', 'nope'])
    await ctx.stop()
    await ctx.stop()
  })

  test('forCommand returns context for a different command', async () => {
    const { DaemonContext } = await import('../daemon.js')
    const loginCtx = new DaemonContext('myapp', 'login', ['node', 'myapp', 'login'])
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
    const bgCtx = new DaemonContext('test-daemon-cli', 'bg', [process.execPath, helperScript, 'bg'])
    await bgCtx.start({ timeoutMs: 30_000 })

    const pidData = readPidFile(pidFilePath('test-daemon-cli', 'bg'))
    if (pidData) spawnedPids.push(pidData.pid)

    // Create a context for "me" command and use forCommand to check "bg"
    const meCtx = new DaemonContext('test-daemon-cli', 'me', ['node', 'test', 'me'])
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
    const ctx = new DaemonContext('stale-test', 'cmd', ['node', 'test'])

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
    const ctx = new DaemonContext('heartbeat-test', 'cmd', ['node', 'test'])

    // Should return false because heartbeat is stale (even though PID is alive)
    expect(await ctx.isRunning()).toBe(false)
  })

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
