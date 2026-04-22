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

type JustBashExecutionContext = Pick<CommandContext, 'cwd' | 'env' | 'fs' | 'stdin' | 'limits'>

const TRUNCATION_MESSAGE = '\n[output truncated]\n'

function createTextCaptureStreams(maxLength?: number): {
  stdout: GokeOutputStream
  stderr: GokeOutputStream
  getResult(): { stdout: string; stderr: string }
} {
  const stdoutChunks: string[] = []
  const stderrChunks: string[] = []
  const limit = maxLength != null && maxLength > 0 ? maxLength : Number.POSITIVE_INFINITY
  let totalLength = 0
  let stdoutTruncated = false
  let stderrTruncated = false

  const createStream = (stream: 'stdout' | 'stderr'): GokeOutputStream => ({
    write(data: string) {
      if (totalLength >= limit) {
        if (stream === 'stdout') {
          stdoutTruncated = true
        } else {
          stderrTruncated = true
        }
        return
      }

      const remaining = limit - totalLength
      const text = data.length <= remaining ? data : data.slice(0, remaining)
      if (stream === 'stdout') {
        stdoutChunks.push(text)
        stdoutTruncated ||= text.length !== data.length
      } else {
        stderrChunks.push(text)
        stderrTruncated ||= text.length !== data.length
      }
      totalLength += text.length
    },
  })

  const trimEnd = (value: string, count: number) => value.slice(0, Math.max(0, value.length - count))

  return {
    stdout: createStream('stdout'),
    stderr: createStream('stderr'),
    getResult() {
      let stdout = stdoutChunks.join('')
      let stderr = stderrChunks.join('')

      if (!stdoutTruncated && !stderrTruncated) {
        return { stdout, stderr }
      }

      const target = stderrTruncated ? 'stderr' : 'stdout'
      const message = limit === Number.POSITIVE_INFINITY
        ? TRUNCATION_MESSAGE
        : TRUNCATION_MESSAGE.slice(0, Math.min(TRUNCATION_MESSAGE.length, limit))

      let overflow = stdout.length + stderr.length + message.length - limit
      if (Number.isFinite(limit) && overflow > 0) {
        if (target === 'stderr') {
          const stderrTrim = Math.min(overflow, stderr.length)
          stderr = trimEnd(stderr, stderrTrim)
          overflow -= stderrTrim
          if (overflow > 0) {
            stdout = trimEnd(stdout, overflow)
          }
        } else {
          const stdoutTrim = Math.min(overflow, stdout.length)
          stdout = trimEnd(stdout, stdoutTrim)
          overflow -= stdoutTrim
          if (overflow > 0) {
            stderr = trimEnd(stderr, overflow)
          }
        }
      }

      if (target === 'stderr') {
        stderr += message
      } else {
        stdout += message
      }

      return { stdout, stderr }
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

const toJustBashEncoding = (encoding?: BufferEncoding | null): 'utf8' | 'utf-8' | 'ascii' | 'binary' | 'base64' | 'hex' | 'latin1' | null | undefined => {
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

function createJustBashEnvProxy(env: Map<string, string>): Record<string, string | undefined> {
  return new Proxy(Object.create(null) as Record<string, string | undefined>, {
    deleteProperty(_target, property) {
      if (typeof property === 'string') {
        env.delete(property)
      }
      return true
    },
    get(_target, property) {
      if (typeof property !== 'string') return undefined
      return env.get(property)
    },
    getOwnPropertyDescriptor(_target, property) {
      if (typeof property !== 'string') return undefined
      const value = env.get(property)
      if (value === undefined) return undefined
      return {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      }
    },
    has(_target, property) {
      return typeof property === 'string' && env.has(property)
    },
    ownKeys() {
      return [...env.keys()]
    },
    set(_target, property, value) {
      if (typeof property === 'string') {
        if (value === undefined) {
          env.delete(property)
        } else {
          env.set(property, String(value))
        }
      }
      return true
    },
  })
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
      const output = createTextCaptureStreams(context?.limits?.maxOutputSize)
      const argv = ['node', name, ...args]
      const cloned = cli.clone({
        cwd: context?.cwd,
        env: context ? createJustBashEnvProxy(context.env) : cli.env,
        fs: context ? createJustBashFs(context.fs, context.cwd) : cli.fs,
        stdin: context?.stdin,
        stdout: output.stdout,
        stderr: output.stderr,
        argv,
        exit: (code) => {
          throw new GokeProcessExit(code)
        },
      })

      cloned.name = name

      try {
        cloned.parse(argv, { run: false })
        await cloned.runMatchedCommand()
        const result = output.getResult()
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: 0,
        }
      } catch (error) {
        if (error instanceof GokeProcessExit) {
          const result = output.getResult()
          return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: error.code,
          }
        }
        throw error
      }
    },
  }
}

export type { JustBashCommand, JustBashExecResult }
