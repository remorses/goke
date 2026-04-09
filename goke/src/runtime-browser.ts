/**
 * Browser-safe runtime stubs for goke core.
 */

type Listener = (...args: any[]) => void

class EventEmitter {
  #listeners = new Map<string | symbol, Listener[]>()

  on(eventName: string | symbol, listener: Listener) {
    const listeners = this.#listeners.get(eventName) ?? []
    listeners.push(listener)
    this.#listeners.set(eventName, listeners)
    return this
  }

  emit(eventName: string | symbol, ...args: any[]) {
    const listeners = this.#listeners.get(eventName)
    if (!listeners || listeners.length === 0) return false
    for (const listener of listeners) {
      listener(...args)
    }
    return true
  }

  eventNames() {
    return [...this.#listeners.keys()]
  }

  listeners(eventName: string | symbol) {
    return [...(this.#listeners.get(eventName) ?? [])]
  }
}

const createOutputStream = () => ({
  columns: Number.POSITIVE_INFINITY,
  isTTY: false,
  write(_data: string) {},
})

const process = {
  argv: [] as string[],
  arch: 'browser',
  platform: 'browser',
  version: 'browser',
  stdout: createOutputStream(),
  stderr: createOutputStream(),
  exit(code: number): never {
    throw new Error(
      `process.exit(${code}) is not available in the browser runtime. Pass a custom exit handler to goke(...).`
    )
  },
}

function openInBrowser(_url: string): void {
  // Browser builds should decide how to surface URLs themselves.
}

export { EventEmitter, openInBrowser, process }
