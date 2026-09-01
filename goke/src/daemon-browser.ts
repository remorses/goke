/**
 * Browser-safe daemon stub.
 *
 * Provides the same DaemonContext interface as daemon.ts but without
 * Node.js dependencies. Process-dependent methods throw, while lifecycle
 * queries remain no-ops. Used in browser and edge runtimes.
 */

import type {
  CreateDaemonContextOptions,
  DaemonStartOptions,
  DaemonStartupMessageOptions,
} from './daemon.js'

class DaemonContext {
  readonly isDaemon = false as const

  constructor() {}

  forCommand(_commandName: string): DaemonContext {
    return new DaemonContext()
  }

  publishStartupMessage(_message: string, _options?: DaemonStartupMessageOptions): void {
    throw new Error('ctx.daemon.publishStartupMessage() is only available in Node.js runtimes.')
  }

  ready(): void {
    throw new Error('ctx.daemon.ready() is only available in Node.js runtimes.')
  }

  async start(_options?: DaemonStartOptions): Promise<void> {
    throw new Error('ctx.daemon.start() is only available in Node.js runtimes.')
  }

  async stop(): Promise<void> {}

  async isRunning(): Promise<boolean> {
    return false
  }
}

function createDaemonContext(_options: CreateDaemonContextOptions): DaemonContext {
  return new DaemonContext()
}

export { DaemonContext, createDaemonContext }
export type { DaemonStartOptions, DaemonStartupMessageOptions } from './daemon.js'
