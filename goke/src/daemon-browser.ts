/**
 * Browser-safe daemon stub.
 *
 * Provides the same DaemonContext interface as daemon.ts but without
 * Node.js dependencies. start() throws; everything else is a no-op.
 * Used via the #daemon conditional import in browser/edge runtimes.
 */

class DaemonContext {
  readonly isDaemon = false as const

  constructor() {}

  forCommand(_commandName: string): DaemonContext {
    return new DaemonContext()
  }

  async start(): Promise<void> {
    throw new Error('ctx.daemon.start() is only available in Node.js runtimes.')
  }

  async stop(): Promise<void> {}

  async isRunning(): Promise<boolean> {
    return false
  }
}

function createDaemonContext(): DaemonContext {
  return new DaemonContext()
}

export { DaemonContext, createDaemonContext }
export type { DaemonStartOptions } from './daemon.js'
