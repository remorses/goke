/**
 * Node-like filesystem types used by injected goke execution contexts.
 */

import type { MakeDirectoryOptions, Mode, PathLike, RmOptions, TimeLike } from 'node:fs'

type GokeFsFileContent = string | NodeJS.ArrayBufferView
type GokeFsEncodingOption = BufferEncoding | { encoding?: BufferEncoding | null }

interface GokeFs {
  appendFile(path: PathLike, data: GokeFsFileContent, options?: GokeFsEncodingOption): Promise<void>
  chmod(path: PathLike, mode: Mode): Promise<void>
  copyFile(src: PathLike, dest: PathLike): Promise<void>
  link(existingPath: PathLike, newPath: PathLike): Promise<void>
  mkdir(path: PathLike, options?: MakeDirectoryOptions): Promise<string | undefined>
  readFile(path: PathLike, options?: GokeFsEncodingOption): Promise<string | Uint8Array>
  readlink(path: PathLike): Promise<string>
  realpath(path: PathLike): Promise<string>
  rename(oldPath: PathLike, newPath: PathLike): Promise<void>
  rm(path: PathLike, options?: RmOptions): Promise<void>
  symlink(target: PathLike, path: PathLike): Promise<void>
  utimes(path: PathLike, atime: TimeLike, mtime: TimeLike): Promise<void>
  writeFile(path: PathLike, data: GokeFsFileContent, options?: GokeFsEncodingOption): Promise<void>
}

export type { GokeFs, GokeFsEncodingOption, GokeFsFileContent }
