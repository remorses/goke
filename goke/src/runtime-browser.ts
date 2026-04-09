/**
 * Browser-safe runtime stubs for goke core.
 */

import type { GokeFs } from './goke-fs.js'

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

function createBrowserFsError(methodName: string) {
  return new Error(
    `fs.${methodName}() is not available in the browser runtime. Pass a custom fs implementation to goke(...).`
  )
}

function createUnsupportedFsMethod<T>(methodName: string): T {
  return (async () => {
    throw createBrowserFsError(methodName)
  }) as T
}

const fs: GokeFs = {
  appendFile: createUnsupportedFsMethod<GokeFs['appendFile']>('appendFile'),
  chmod: createUnsupportedFsMethod<GokeFs['chmod']>('chmod'),
  copyFile: createUnsupportedFsMethod<GokeFs['copyFile']>('copyFile'),
  link: createUnsupportedFsMethod<GokeFs['link']>('link'),
  mkdir: createUnsupportedFsMethod<GokeFs['mkdir']>('mkdir'),
  readFile: createUnsupportedFsMethod<GokeFs['readFile']>('readFile'),
  readlink: createUnsupportedFsMethod<GokeFs['readlink']>('readlink'),
  realpath: createUnsupportedFsMethod<GokeFs['realpath']>('realpath'),
  rename: createUnsupportedFsMethod<GokeFs['rename']>('rename'),
  rm: createUnsupportedFsMethod<GokeFs['rm']>('rm'),
  symlink: createUnsupportedFsMethod<GokeFs['symlink']>('symlink'),
  utimes: createUnsupportedFsMethod<GokeFs['utimes']>('utimes'),
  writeFile: createUnsupportedFsMethod<GokeFs['writeFile']>('writeFile'),
}

function openInBrowser(_url: string): void {
  // Browser builds should decide how to surface URLs themselves.
}

export { EventEmitter, fs, openInBrowser, process }
