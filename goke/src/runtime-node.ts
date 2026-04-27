/**
 * Node.js runtime bindings for goke core.
 */

import { exec } from 'child_process'
import { EventEmitter } from 'events'
import * as nodeFs from 'node:fs/promises'
import type { GokeFs } from './goke-fs.js'

const process = globalThis.process
const fs: GokeFs = nodeFs

async function openInBrowser(url: string): Promise<void> {
  if (!process.stdout.isTTY) {
    process.stdout.write(url + '\n')
    return
  }

  let cmd: string
  if (process.platform === 'darwin') {
    cmd = `open ${JSON.stringify(url)}`
  } else if (process.platform === 'win32') {
    cmd = `start "" ${JSON.stringify(url)}`
  } else {
    cmd = `xdg-open ${JSON.stringify(url)}`
  }

  try {
    await new Promise<void>((resolve, reject) => {
      exec(cmd, { stdio: 'ignore' } as any, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  } catch {
    process.stdout.write(url + '\n')
  }
}

export { EventEmitter, fs, openInBrowser, process }
