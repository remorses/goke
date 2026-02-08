// Vendored from mri@1.2.0 by Luke Edwards (MIT license)
// https://github.com/lukeed/mri
// Converted to TypeScript for zero-dependency bundling.

type Dict<T> = Record<string, T>
type Arrayable<T> = T | T[]

export interface MriOptions {
  boolean?: Arrayable<string>
  string?: Arrayable<string>
  alias?: Dict<Arrayable<string>>
  default?: Dict<any>
  unknown?(flag: string): void
}

export type MriArgv<T = Dict<any>> = T & {
  _: string[]
}

function toArr(any: Arrayable<string> | undefined): string[] {
  return any == null ? [] : Array.isArray(any) ? any : [any]
}

// Automatic number coercion is intentionally disabled.
// All non-boolean values are kept as strings. Type conversion is handled
// by coerceBySchema() using JSON Schema after mri parsing is complete.
// This prevents silent data loss (e.g. "00123" → 123, "+1234567890" → 1234567890).
function toVal(
  out: Record<string, any>,
  key: string,
  val: any,
  opts: { string: string[]; boolean: string[]; _: string[] }
): void {
  const old = out[key]
  const nxt =
    !!~opts.string.indexOf(key)
      ? val == null || val === true
        ? ''
        : String(val)
      : typeof val === 'boolean'
        ? val
        : !!~opts.boolean.indexOf(key)
          ? val === 'false'
            ? false
            : val === 'true' ||
              (out._.push(val), !!val)
          : val
  out[key] = old == null ? nxt : Array.isArray(old) ? old.concat(nxt) : [old, nxt]
}

export default function mri(args?: string[], opts?: MriOptions): MriArgv {
  args = args || []
  opts = opts || {}

  let k: string
  let arr: string[]
  let arg: string
  let name: string
  let val: any
  const out: Record<string, any> = { _: [] }
  let i = 0
  let j = 0
  let idx = 0
  const len = args.length

  const alibi = opts.alias !== undefined
  const strict = opts.unknown !== undefined
  const defaults = opts.default !== undefined

  const alias: Dict<string[]> = (opts.alias as Dict<string[]>) || {}
  const string = toArr(opts.string)
  const boolean = toArr(opts.boolean)

  const resolvedOpts = { alias, string, boolean, default: opts.default, unknown: opts.unknown, _: out._ }

  if (alibi) {
    for (k in alias) {
      arr = alias[k] = toArr(alias[k] as Arrayable<string>)
      for (i = 0; i < arr.length; i++) {
        ;(alias[arr[i]] = arr.concat(k)).splice(i, 1)
      }
    }
  }

  for (i = boolean.length; i-- > 0; ) {
    arr = alias[boolean[i]] || []
    for (j = arr.length; j-- > 0; ) boolean.push(arr[j])
  }

  for (i = string.length; i-- > 0; ) {
    arr = alias[string[i]] || []
    for (j = arr.length; j-- > 0; ) string.push(arr[j])
  }

  if (defaults) {
    for (k in opts.default!) {
      name = typeof opts.default![k]
      arr = alias[k] = alias[k] || []
      if ((resolvedOpts as any)[name] !== undefined) {
        ;(resolvedOpts as any)[name].push(k)
        for (i = 0; i < arr.length; i++) {
          ;(resolvedOpts as any)[name].push(arr[i])
        }
      }
    }
  }

  const keys = strict ? Object.keys(alias) : []

  for (i = 0; i < len; i++) {
    arg = args[i]

    if (arg === '--') {
      out._ = out._.concat(args.slice(++i))
      break
    }

    for (j = 0; j < arg.length; j++) {
      if (arg.charCodeAt(j) !== 45) break // "-"
    }

    if (j === 0) {
      out._.push(arg)
    } else {
      for (idx = j + 1; idx < arg.length; idx++) {
        if (arg.charCodeAt(idx) === 61) break // "="
      }

      name = arg.substring(j, idx)
      val =
        arg.substring(++idx) ||
        (i + 1 === len ||
        ('' + args[i + 1]).charCodeAt(0) === 45 ||
        args[++i])
      arr = j === 2 ? [name] : (name as any)

      for (idx = 0; idx < arr.length; idx++) {
        name = arr[idx]
        if (strict && !~keys.indexOf(name))
          return opts.unknown!('-'.repeat(j) + name) as any
        toVal(out, name, idx + 1 < arr.length || val, resolvedOpts)
      }
    }
  }

  if (defaults) {
    for (k in opts.default!) {
      if (out[k] === undefined) {
        out[k] = opts.default![k]
      }
    }
  }

  if (alibi) {
    for (k in out) {
      arr = alias[k] || []
      while (arr.length > 0) {
        out[arr.shift()!] = out[k]
      }
    }
  }

  return out as MriArgv
}
