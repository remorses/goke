/**
 * Runtime adapter that exposes a goke CLI as a JustBash-compatible custom command.
 *
 * Structural types here are based on JustBash source definitions:
 * - https://github.com/vercel-labs/just-bash/blob/main/src/custom-commands.ts
 * - https://github.com/vercel-labs/just-bash/blob/main/src/types.ts
 */

import Goke, { GokeProcessExit } from './goke.js'
import type { GokeOutputStream } from './goke.js'

interface JustBashExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

interface JustBashCommand {
  name: string
  trusted: true
  execute(args: string[]): Promise<JustBashExecResult>
}

function createTextCaptureStream(): GokeOutputStream & { readonly text: string } {
  const chunks: string[] = []
  return {
    get text() {
      return chunks.join('')
    },
    write(data: string) {
      chunks.push(data)
    },
  }
}

export function createJustBashCommand(
  cli: Goke<any>,
  options?: { name?: string }
): JustBashCommand {
  const name = options?.name ?? cli.name

  if (!name) {
    throw new Error('createJustBashCommand() requires the CLI to have a name')
  }

  if (name.split(/\s+/).length > 1) {
    throw new Error('JustBash custom command names must be a single token')
  }

  return {
    name,
    trusted: true,
    async execute(args: string[]) {
      const stdout = createTextCaptureStream()
      const stderr = createTextCaptureStream()
      const argv = ['node', name, ...args]
      const cloned = cli.clone({
        stdout,
        stderr,
        argv,
        exit: (code) => {
          throw new GokeProcessExit(code)
        },
      })

      cloned.name = name

      try {
        cloned.parse(argv, { run: false })
        await cloned.runMatchedCommand()
        return {
          stdout: stdout.text,
          stderr: stderr.text,
          exitCode: 0,
        }
      } catch (error) {
        if (error instanceof GokeProcessExit) {
          return {
            stdout: stdout.text,
            stderr: stderr.text,
            exitCode: error.code,
          }
        }
        throw error
      }
    },
  }
}

export type { JustBashCommand, JustBashExecResult }
