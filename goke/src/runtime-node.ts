/**
 * Node.js runtime bindings for goke core.
 */

import { execSync } from 'child_process'
import { EventEmitter } from 'events'
import * as nodeFs from 'node:fs/promises'
import type { GokeFs } from './goke-fs.js'

const process = globalThis.process
const fs: GokeFs = nodeFs

function openInBrowser(url: string): void {
  if (!process.stdout.isTTY) {
    process.stdout.write(url + '\n')
    return
  }

  try {
    if (process.platform === 'darwin') {
      execSync(`open ${JSON.stringify(url)}`, { stdio: 'ignore' })
    } else if (process.platform === 'win32') {
      execSync(`start "" ${JSON.stringify(url)}`, { stdio: 'ignore' })
    } else {
      execSync(`xdg-open ${JSON.stringify(url)}`, { stdio: 'ignore' })
    }
  } catch {
    process.stdout.write(url + '\n')
  }
}

export { EventEmitter, fs, openInBrowser, process }
