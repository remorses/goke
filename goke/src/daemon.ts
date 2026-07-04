/**
 * Background daemon support for goke CLIs.
 *
 * Lets a command fork itself into a detached background process. The daemon
 * is identified by CLI name + command name, with a PID file for lifecycle
 * management. No HTTP server, no ports. Communication between client and
 * daemon happens via shared files (config, auth, state) that the CLI
 * already manages.
 *
 * How it works:
 *   1. Command action checks `ctx.daemon.isDaemon` to branch behavior
 *   2. Client calls `ctx.daemon.start()` which re-spawns the same CLI
 *      command with GOKE_DAEMON=1 env var, detached + unref'd
 *   3. Daemon process runs the same action, but `isDaemon` is true
 *   4. Daemon auto-exits after timeoutMs
 *   5. PID file tracks the running daemon for stop/isRunning checks
 *
 * PID file safety:
 *   Each daemon writes a unique instance ID (random hex) into the PID file.
 *   A heartbeat timestamp is updated every 5 seconds. `isRunning()` checks
 *   both that the PID is alive AND the heartbeat is recent (< 15s). This
 *   prevents false positives from PID reuse after a daemon crash.
 *   Cleanup handlers only remove the PID file if its ID matches the current
 *   instance, so a new daemon won't have its file deleted by an old one's
 *   exit handler firing late.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

// ─── PID file management ───

const DAEMON_DIR = path.join(os.homedir(), '.config', 'goke', 'daemons')

/**
 * Build the PID file path for a daemon identified by CLI name + command name.
 * Example: ~/.config/goke/daemons/playwriter--cloud-login.pid.json
 */
function pidFilePath(cliName: string, commandName: string): string {
  const safeName = `${cliName}--${commandName}`
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '')
  return path.join(DAEMON_DIR, `${safeName}.pid.json`)
}

interface PidFileData {
  pid: number
  /** Random hex string unique to this daemon instance. Prevents PID reuse confusion. */
  id: string
  startedAt: number
  /** Updated every ~5s by the daemon. Stale heartbeat = daemon is dead. */
  heartbeatAt: number
}

function readPidFile(filePath: string): PidFileData | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as PidFileData
    if (typeof data.pid !== 'number' || typeof data.id !== 'string') {
      return null
    }
    return data
  } catch {
    return null
  }
}

function writePidFile(filePath: string, data: PidFileData): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data), { encoding: 'utf-8', mode: 0o600 })
}

/**
 * Remove a PID file only if it belongs to the given instance.
 * Prevents a dying daemon from deleting a newer daemon's PID file.
 */
function removePidFileIfOwned(filePath: string, instanceId: string): void {
  try {
    const current = readPidFile(filePath)
    if (current && current.id === instanceId) {
      fs.unlinkSync(filePath)
    }
  } catch {
    // already gone or permission issue
  }
}

function removePidFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath)
  } catch {
    // already gone
  }
}

/**
 * Check if a process with the given PID is still alive.
 * Uses signal 0 which doesn't actually send a signal, just checks existence.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Max age in ms for a heartbeat to be considered fresh. */
const HEARTBEAT_STALE_MS = 15_000

/** Interval in ms between heartbeat updates. */
const HEARTBEAT_INTERVAL_MS = 5_000

/**
 * Check if a PID file represents a daemon that is truly running.
 * Requires both: PID alive AND heartbeat recent.
 */
function isDaemonAlive(data: PidFileData): boolean {
  if (!isProcessAlive(data.pid)) {
    return false
  }
  // If heartbeat is stale, the process might be alive but not our daemon (PID reuse)
  const heartbeatAge = Date.now() - data.heartbeatAt
  return heartbeatAge < HEARTBEAT_STALE_MS
}

/**
 * Kill a process by PID. Tries SIGTERM first, then SIGKILL after a delay.
 */
async function killProcess(pid: number): Promise<void> {
  if (!isProcessAlive(pid)) {
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return // already dead
  }

  // Wait up to 3 seconds for graceful shutdown
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return
    }
    await new Promise((r) => setTimeout(r, 100))
  }

  // Force kill if still alive
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // already dead
  }
}

// ─── Daemon context ───

const DAEMON_ENV_KEY = 'GOKE_DAEMON'
const DAEMON_TIMEOUT_ENV_KEY = 'GOKE_DAEMON_TIMEOUT'

interface DaemonStartOptions {
  /** Auto-exit timeout in milliseconds. Default: 10 minutes. */
  timeoutMs?: number
  /** Extra environment variables passed to the daemon process. */
  env?: Record<string, string>
  /**
   * When true, pipe daemon stdout/stderr to the parent process and wait
   * for the daemon to exit before resolving. This lets interactive users
   * see real-time logs and error messages from the daemon.
   *
   * When false (default), the daemon runs fully detached with no stdio
   * and start() returns as soon as the PID file is confirmed.
   */
  attach?: boolean
}

/**
 * Daemon context available on every command's execution context.
 *
 * Lets a command fork itself into a background process. The client side
 * calls `start()` to spawn the daemon. The daemon side checks `isDaemon`
 * and does its work. Communication happens via shared files.
 *
 * Use `forCommand()` to get a daemon context for a different command.
 * This is useful for commands like `me` or `logout` that need to check
 * or stop the `login` daemon.
 */
class DaemonContext {
  /** True when this process IS the background daemon. */
  readonly isDaemon: boolean

  #cliName: string
  #commandName: string
  #argv: string[]
  #env: Record<string, string | undefined>
  #pidFile: string
  #instanceId: string | null = null
  #heartbeatInterval: ReturnType<typeof setInterval> | null = null
  #timeoutTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    cliName: string,
    commandName: string,
    argv: string[],
    env?: Record<string, string | undefined>,
  ) {
    this.#cliName = cliName
    this.#commandName = commandName
    this.#argv = argv
    this.#env = env ?? process.env
    this.#pidFile = pidFilePath(cliName, commandName)
    this.isDaemon = this.#env[DAEMON_ENV_KEY] === '1'

    if (this.isDaemon) {
      this.#setupDaemonProcess()
    }
  }

  /**
   * Get a daemon context for a different command on the same CLI.
   * Useful for cross-command daemon management (e.g. `me` checking `login` daemon).
   *
   * The returned context is always in client mode (isDaemon=false) regardless
   * of the current process's daemon state, since it represents a different command.
   */
  forCommand(commandName: string): DaemonContext {
    // Strip daemon env vars so the returned context is always client mode,
    // even when called from inside a daemon process. Without this, GOKE_DAEMON=1
    // leaks through and the new context enters server mode, writing a PID file
    // for the wrong command.
    const env = { ...this.#env }
    delete env[DAEMON_ENV_KEY]
    delete env[DAEMON_TIMEOUT_ENV_KEY]
    return new DaemonContext(this.#cliName, commandName, this.#argv, env)
  }

  /**
   * Set up the daemon process: write PID file, start heartbeat,
   * schedule auto-exit, handle signals and exit for graceful cleanup.
   */
  #setupDaemonProcess(): void {
    this.#instanceId = crypto.randomBytes(8).toString('hex')
    const now = Date.now()

    const pidData: PidFileData = {
      pid: process.pid,
      id: this.#instanceId,
      startedAt: now,
      heartbeatAt: now,
    }
    writePidFile(this.#pidFile, pidData)

    // Heartbeat: update the PID file timestamp every 5 seconds so clients
    // can distinguish a live daemon from a stale PID (PID reuse scenario).
    this.#heartbeatInterval = setInterval(() => {
      const current = readPidFile(this.#pidFile)
      if (current && current.id === this.#instanceId) {
        current.heartbeatAt = Date.now()
        writePidFile(this.#pidFile, current)
      }
    }, HEARTBEAT_INTERVAL_MS)
    // Heartbeat should not keep the process alive on its own
    this.#heartbeatInterval.unref()

    const timeoutMs = Number(this.#env[DAEMON_TIMEOUT_ENV_KEY]) || 10 * 60 * 1000
    this.#timeoutTimer = setTimeout(() => {
      this.#cleanup()
      process.exit(0)
    }, timeoutMs)
    // unref so the timer alone doesn't keep the process alive. The daemon
    // stays alive as long as real work keeps the event loop open (polling
    // timers, HTTP servers, etc.). When all work finishes, the process
    // exits naturally. The timeout is a safety net, not a keepalive.
    this.#timeoutTimer.unref()

    const cleanupAndExit = () => {
      this.#cleanup()
      process.exit(0)
    }

    process.on('SIGTERM', cleanupAndExit)
    process.on('SIGINT', cleanupAndExit)

    // Clean up PID file on any exit (including uncaught exceptions, action throws, etc.)
    // Only remove if the file still belongs to this instance.
    process.on('exit', () => {
      if (this.#instanceId) {
        if (this.#heartbeatInterval) clearInterval(this.#heartbeatInterval)
        removePidFileIfOwned(this.#pidFile, this.#instanceId)
      }
    })
  }

  #cleanup(): void {
    if (this.#timeoutTimer) {
      clearTimeout(this.#timeoutTimer)
      this.#timeoutTimer = null
    }
    if (this.#heartbeatInterval) {
      clearInterval(this.#heartbeatInterval)
      this.#heartbeatInterval = null
    }
    if (this.#instanceId) {
      removePidFileIfOwned(this.#pidFile, this.#instanceId)
    }
  }

  /**
   * Spawn the current command as a detached background daemon process.
   * Kills any existing daemon for this command first.
   *
   * When `attach: true`, pipes daemon stdout/stderr to the parent and
   * waits for the daemon to exit. Throws if the daemon exits with a
   * non-zero code. This is useful for interactive login flows where the
   * user wants to see real-time logs and error messages.
   */
  async start(options?: DaemonStartOptions): Promise<void> {
    const timeoutMs = options?.timeoutMs ?? 10 * 60 * 1000
    const attach = options?.attach ?? false

    // Kill existing daemon if running
    await this.stop()

    const env: Record<string, string | undefined> = {
      ...this.#env,
      [DAEMON_ENV_KEY]: '1',
      [DAEMON_TIMEOUT_ENV_KEY]: String(timeoutMs),
      ...options?.env,
    }

    // Re-spawn the same command. argv[0] is the node/bun binary,
    // the rest is the CLI invocation (e.g. ["./bin.js", "cloud", "login"]).
    const execPath = this.#argv[0]
    const args = this.#argv.slice(1)

    const child = spawn(execPath, args, {
      // Detach only when running in background so the daemon outlives the
      // parent. In attached mode, keep the child in the same process group
      // so signals propagate naturally and the parent stays alive.
      detached: !attach,
      stdio: attach ? ['ignore', 'inherit', 'inherit'] : 'ignore',
      env,
    })

    // Only unref when detached (non-attached) so the parent can exit
    // immediately. In attached mode, the parent must stay alive to wait for
    // the child's 'close' event — unref() would let the event loop drain
    // and the parent would exit before the child finishes.
    if (!attach) {
      child.unref()
    }

    // Brief wait to confirm the daemon started and wrote its PID file
    const startDeadline = Date.now() + 5000
    while (Date.now() < startDeadline) {
      await new Promise((r) => setTimeout(r, 100))
      const pidData = readPidFile(this.#pidFile)
      if (pidData && isProcessAlive(pidData.pid)) {
        if (!attach) return

        // Attached mode: wait for the daemon process to exit
        return new Promise<void>((resolve, reject) => {
          child.on('close', (code) => {
            if (code && code !== 0) {
              reject(new Error(`Daemon "${this.#cliName} ${this.#commandName}" exited with code ${code}`))
            } else {
              resolve()
            }
          })
          child.on('error', reject)
        })
      }
    }

    throw new Error(`Failed to start daemon for "${this.#cliName} ${this.#commandName}"`)
  }

  /**
   * Stop the running daemon for this command.
   */
  async stop(): Promise<void> {
    const pidData = readPidFile(this.#pidFile)
    if (!pidData) {
      return
    }

    // Only kill if this is actually our daemon (alive + fresh heartbeat).
    // Without this check, a stale PID file with a reused PID could cause
    // us to kill an unrelated process.
    if (!isDaemonAlive(pidData)) {
      removePidFile(this.#pidFile)
      return
    }

    await killProcess(pidData.pid)
    removePidFile(this.#pidFile)
  }

  /**
   * Check if the daemon for this command is currently running.
   * Verifies both that the PID is alive and the heartbeat is recent
   * to protect against PID reuse after a crash.
   */
  async isRunning(): Promise<boolean> {
    const pidData = readPidFile(this.#pidFile)
    if (!pidData) {
      return false
    }

    if (!isDaemonAlive(pidData)) {
      // Stale PID file, clean up
      removePidFile(this.#pidFile)
      return false
    }

    return true
  }
}

/**
 * Create a DaemonContext for a command.
 * Called internally by goke when building the execution context.
 */
function createDaemonContext(
  cliName: string,
  commandName: string,
  argv: string[],
  env?: Record<string, string | undefined>,
): DaemonContext {
  return new DaemonContext(cliName, commandName, argv, env)
}

export { DaemonContext, createDaemonContext }
export type { DaemonStartOptions }
