/**
 * Node.js runtime bindings for goke core.
 */

import { execSync } from 'child_process'
import { EventEmitter } from 'events'

const process = globalThis.process

function openInBrowser(url: string): void {
  if (!process.stdout.isTTY) {
    process.stderr.write(url + '\n')
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
    process.stderr.write(url + '\n')
  }
}

export { EventEmitter, openInBrowser, process }
