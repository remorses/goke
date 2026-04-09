/**
 * Runtime adapter that exposes a goke CLI as a JustBash-compatible custom command.
 *
 * Structural types here are based on JustBash source definitions:
 * - https://github.com/vercel-labs/just-bash/blob/main/src/custom-commands.ts
 * - https://github.com/vercel-labs/just-bash/blob/main/src/types.ts
 */

import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'
import type { PathLike } from 'node:fs'
import type { CommandContext, IFileSystem } from 'just-bash'
import Goke, { GokeProcessExit } from './goke.js'
import type { GokeOutputStream } from './goke.js'
import type { GokeFs, GokeFsEncodingOption, GokeFsFileContent } from './goke-fs.js'

interface JustBashExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

interface JustBashCommand {
  name: string
  trusted: true
  execute(args: string[], context?: JustBashExecutionContext): Promise<JustBashExecResult>
}

type JustBashExecutionContext = Pick<CommandContext, 'cwd' | 'fs'>
type JustBashEncoding = 'utf8' | 'utf-8' | 'ascii' | 'binary' | 'base64' | 'hex' | 'latin1'

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

const resolveJustBashPath = (fs: IFileSystem, cwd: string, path: PathLike) => {
  if (path instanceof URL) {
    return fileURLToPath(path)
  }
  return fs.resolvePath(cwd, path.toString())
}

const getEncoding = (options?: GokeFsEncodingOption) => {
  if (typeof options === 'string' || options == null) {
    return options
  }
  return options.encoding
}

const toJustBashEncoding = (encoding?: BufferEncoding | null): JustBashEncoding | null | undefined => {
  if (encoding == null) {
    return encoding
  }

  switch (encoding) {
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'hex':
    case 'latin1':
      return encoding
    default:
      throw new Error(`Encoding ${encoding} is not supported by the JustBash fs adapter`)
  }
}

const toJustBashContent = (content: GokeFsFileContent) => {
  if (typeof content === 'string' || content instanceof Uint8Array) {
    return content
  }
  return new Uint8Array(content.buffer, content.byteOffset, content.byteLength)
}

const toDate = (value: Date | string | number) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid time value: ${String(value)}`)
  }
  return date
}

function createJustBashFs(fs: IFileSystem, cwd: string): GokeFs {
  const readFile: GokeFs['readFile'] = async (path, options) => {
    const resolvedPath = resolveJustBashPath(fs, cwd, path)
    const encoding = toJustBashEncoding(getEncoding(options))
    if (encoding == null) {
      return Buffer.from(await fs.readFileBuffer(resolvedPath))
    }
    return fs.readFile(resolvedPath, encoding)
  }

  const writeFile: GokeFs['writeFile'] = async (path, content, options) => {
    const resolvedPath = resolveJustBashPath(fs, cwd, path)
    const encoding = toJustBashEncoding(getEncoding(options)) ?? undefined
    await fs.writeFile(resolvedPath, toJustBashContent(content), encoding)
  }

  const appendFile: GokeFs['appendFile'] = async (path, content, options) => {
    const resolvedPath = resolveJustBashPath(fs, cwd, path)
    const encoding = toJustBashEncoding(getEncoding(options)) ?? undefined
    await fs.appendFile(resolvedPath, toJustBashContent(content), encoding)
  }

  const mkdir: GokeFs['mkdir'] = async (path, options) => {
    await fs.mkdir(resolveJustBashPath(fs, cwd, path), { recursive: typeof options === 'object' ? options.recursive : undefined })
    return undefined
  }

  const rm: GokeFs['rm'] = async (path, options) => {
    await fs.rm(resolveJustBashPath(fs, cwd, path), {
      recursive: options?.recursive,
      force: options?.force,
    })
  }

  const rename: GokeFs['rename'] = async (oldPath, newPath) => {
    await fs.mv(resolveJustBashPath(fs, cwd, oldPath), resolveJustBashPath(fs, cwd, newPath))
  }

  const copyFile: GokeFs['copyFile'] = async (src, dest) => {
    await fs.cp(resolveJustBashPath(fs, cwd, src), resolveJustBashPath(fs, cwd, dest))
  }

  const chmod: GokeFs['chmod'] = async (path, mode) => {
    await fs.chmod(resolveJustBashPath(fs, cwd, path), Number(mode))
  }

  const link: GokeFs['link'] = async (existingPath, newPath) => {
    await fs.link(resolveJustBashPath(fs, cwd, existingPath), resolveJustBashPath(fs, cwd, newPath))
  }

  const readlink: GokeFs['readlink'] = async (path) => {
    return fs.readlink(resolveJustBashPath(fs, cwd, path))
  }

  const realpath: GokeFs['realpath'] = async (path) => {
    return fs.realpath(resolveJustBashPath(fs, cwd, path))
  }

  const symlink: GokeFs['symlink'] = async (target, path) => {
    await fs.symlink(target.toString(), resolveJustBashPath(fs, cwd, path))
  }

  const utimes: GokeFs['utimes'] = async (path, atime, mtime) => {
    await fs.utimes(resolveJustBashPath(fs, cwd, path), toDate(atime), toDate(mtime))
  }

  return {
    appendFile,
    chmod,
    copyFile,
    link,
    mkdir,
    readFile,
    readlink,
    realpath,
    rename,
    rm,
    symlink,
    utimes,
    writeFile,
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
    async execute(args: string[], context?: JustBashExecutionContext) {
      const stdout = createTextCaptureStream()
      const stderr = createTextCaptureStream()
      const argv = ['node', name, ...args]
      const cloned = cli.clone({
        fs: context ? createJustBashFs(context.fs, context.cwd) : cli.fs,
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
