/**
 * Shell completion support for goke CLIs.
 *
 * Two pieces work together:
 * 1. A hidden `--get-goke-completions` flag in the CLI binary. When present,
 *    the CLI skips normal execution and prints matching completions to stdout.
 * 2. A shell-specific shim script installed into an fpath/completion directory.
 *    On each Tab press the shell calls the CLI binary with the flag + current words.
 *
 * The `installCompletions` function finds a writable completion directory and
 * writes the shim. Since the shim calls the binary on every Tab, completions
 * are always up-to-date with the installed CLI.
 */

import { process } from '#runtime'

// ─── Constants ───

/** The hidden flag the shell script passes to the CLI on each Tab press */
export const COMPLETION_FLAG = 'get-goke-completions'

// ─── Shell templates ───

/**
 * Zsh completion script template.
 *
 * The `#compdef` header lets zsh autoload this as an fpath function.
 * On Tab press it calls the CLI binary with `--get-goke-completions` and
 * all typed words. The binary returns `name:description` pairs (one per line)
 * and zsh renders them with `_describe`.
 */
export const zshTemplate = `#compdef {{app_name}}
###-begin-{{app_name}}-completions-###
_{{app_name_safe}}_completions() {
  local reply
  local si=$IFS
  IFS=$'\\n' reply=($(COMP_CWORD="$((CURRENT-1))" COMP_LINE="$BUFFER" COMP_POINT="$CURSOR" GOKE_COMPLETION_SHELL=zsh {{app_path}} --get-goke-completions "\${words[@]}"))
  IFS=$si
  if [[ \${#reply} -gt 0 ]]; then
    _describe 'values' reply
  else
    _default
  fi
}
if [[ "'\${zsh_eval_context[-1]}" == "loadautofunc" ]]; then
  _{{app_name_safe}}_completions "$@"
else
  compdef _{{app_name_safe}}_completions {{app_name}}
fi
###-end-{{app_name}}-completions-###
`

/**
 * Bash completion script template.
 *
 * On Tab press bash calls the function which invokes the CLI binary with
 * `--get-goke-completions` and all typed words. The binary returns plain
 * completion strings (one per line).
 */
export const bashTemplate = `###-begin-{{app_name}}-completions-###
_{{app_name_safe}}_completions()
{
    local cur_word args type_list

    cur_word="\${COMP_WORDS[COMP_CWORD]}"
    args=("\${COMP_WORDS[@]}")

    # Bash 3 compatible (no mapfile). Works on macOS default bash.
    local IFS=$'\\n'
    type_list=($(GOKE_COMPLETION_SHELL=bash {{app_path}} --get-goke-completions "\${args[@]}"))
    unset IFS
    COMPREPLY=($(compgen -W "$( printf '%q ' "\${type_list[@]}" )" -- "\${cur_word}" |
        awk '/ / { print "\\""$0"\\"" } /^[^ ]+$/ { print $0 }'))

    if [ \${#COMPREPLY[@]} -eq 0 ]; then
      COMPREPLY=()
    fi

    return 0
}
complete -o bashdefault -o default -F _{{app_name_safe}}_completions {{app_name}}
###-end-{{app_name}}-completions-###
`

// ─── Script generation ───

export type ShellType = 'zsh' | 'bash'

/**
 * Detect the current shell from environment variables.
 * Returns 'zsh', 'bash', or null if unrecognized.
 */
export function detectShell(): ShellType | null {
  const shell = process.env.SHELL ?? ''
  if (shell.includes('zsh')) return 'zsh'
  if (shell.includes('bash')) return 'bash'
  return null
}

/**
 * Validate and normalize a shell value from user input.
 * Returns a valid ShellType or throws if the value is invalid.
 */
export function validateShell(value: unknown): ShellType | undefined {
  if (value == null || value === '') return undefined
  if (value === 'zsh' || value === 'bash') return value
  throw new Error(`Invalid shell "${String(value)}". Expected "zsh" or "bash".`)
}

/**
 * Detect which shell format to use for completion output.
 * Prefers the explicit GOKE_COMPLETION_SHELL env var (set by the shell shim)
 * over the login $SHELL. This prevents format mismatch when a bash shim runs
 * on a system where $SHELL is zsh.
 */
export function detectCompletionShell(): ShellType | null {
  const explicit = process.env.GOKE_COMPLETION_SHELL
  if (explicit === 'zsh' || explicit === 'bash') return explicit
  return detectShell()
}

/**
 * Make a string safe for use as a shell function name.
 * Replaces non-alphanumeric chars with underscores.
 */
function safeShellName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_')
}

/**
 * Generate a completion script for the given shell.
 *
 * @param shell - Target shell ('zsh' or 'bash')
 * @param cliName - The CLI binary name (e.g. 'my-cli')
 * @param cliPath - Full path to the CLI binary. If not provided, uses cliName.
 */
export function generateCompletionScript(
  shell: ShellType,
  cliName: string,
  cliPath?: string,
): string {
  const template = shell === 'zsh' ? zshTemplate : bashTemplate
  const path = cliPath ?? cliName
  const safeName = safeShellName(cliName)

  return template
    .replace(/{{app_name}}/g, cliName)
    .replace(/{{app_name_safe}}/g, safeName)
    .replace(/{{app_path}}/g, path)
}

// ─── Well-known completion directories ───

/**
 * Well-known zsh fpath directories, ordered by preference.
 * The first writable one wins.
 */
const ZSH_FPATH_CANDIDATES = [
  // Homebrew (macOS arm64) — user-writable
  '/opt/homebrew/share/zsh/site-functions',
  // Homebrew (macOS x86) / Linux system-wide
  '/usr/local/share/zsh/site-functions',
  // OS vendor
  '/usr/share/zsh/site-functions',
  // User-level fallback (no sudo needed, but user must add to fpath in .zshrc)
  `${process.env.HOME}/.zsh/completions`,
]

/**
 * Well-known bash completion directories, ordered by preference.
 */
const BASH_COMPLETION_CANDIDATES = [
  // XDG standard (user-writable)
  `${process.env.HOME}/.local/share/bash-completion/completions`,
  // Legacy user dir
  `${process.env.HOME}/.bash_completion.d`,
]

// ─── Installation ───

interface InstallResult {
  /** The file path where the completion script was written */
  path: string
  /** The shell the script was generated for */
  shell: ShellType
}

/**
 * Find a writable completion directory, generate the shell script, and write it.
 *
 * For zsh, scans `$fpath` directories plus well-known fallbacks.
 * For bash, scans XDG and legacy user completion dirs.
 *
 * Throws if no writable directory is found.
 *
 * @param cliName - The CLI binary name
 * @param cliPath - Full path to the CLI binary
 * @param shell - Target shell. Auto-detected from $SHELL if omitted.
 */
export async function installCompletions(
  cliName: string,
  cliPath: string,
  shell?: ShellType,
): Promise<InstallResult> {
  const { existsSync, mkdirSync, writeFileSync, accessSync, constants } = await import('node:fs')
  const { execSync } = await import('node:child_process')
  const { join } = await import('node:path')

  const targetShell = shell ?? detectShell()
  if (!targetShell) {
    throw new Error(
      'Could not detect shell. Set the SHELL environment variable or pass --shell explicitly.',
    )
  }

  const script = generateCompletionScript(targetShell, cliName, cliPath)

  // Build candidate directories
  let candidates: string[]
  let filename: string

  if (targetShell === 'zsh') {
    filename = `_${cliName}`

    // Get live $fpath from zsh if available
    let fpathDirs: string[] = []
    try {
      const fpathOutput = execSync('zsh -c "echo $fpath"', {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim()
      fpathDirs = fpathOutput.split(/\s+/).filter(Boolean)
    } catch {
      // zsh not available, fall through to well-known paths
    }

    // Deduplicate: fpath dirs first (in order), then well-known fallbacks
    const seen = new Set<string>()
    candidates = []
    const userZshDir = `${process.env.HOME}/.zsh/completions`
    for (const dir of [...fpathDirs, ...ZSH_FPATH_CANDIDATES]) {
      if (seen.has(dir)) continue
      seen.add(dir)
      // Auto-create the user-level ~/.zsh/completions dir if it's a candidate
      if (!existsSync(dir) && dir === userZshDir) {
        try {
          mkdirSync(dir, { recursive: true })
        } catch {
          continue
        }
      }
      if (existsSync(dir)) {
        candidates.push(dir)
      }
    }
  } else {
    filename = cliName
    candidates = BASH_COMPLETION_CANDIDATES.filter((dir) => {
      // For bash dirs, check parent exists or try creating
      try {
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true })
        }
        return true
      } catch {
        return false
      }
    })
  }

  // Find first writable directory
  for (const dir of candidates) {
    try {
      accessSync(dir, constants.W_OK)
      const filePath = join(dir, filename)
      writeFileSync(filePath, script, 'utf-8')
      return { path: filePath, shell: targetShell }
    } catch {
      // Not writable, try next
      continue
    }
  }

  // No writable directory found
  const triedPaths = candidates.length > 0
    ? candidates.map((d) => `  - ${d}`).join('\n')
    : '  (none found)'

  const hint = targetShell === 'zsh'
    ? 'Create ~/.zsh/completions and add `fpath=(~/.zsh/completions $fpath)` to your .zshrc, then run this command again.'
    : 'Create ~/.local/share/bash-completion/completions and run this command again.'

  throw new Error(
    `No writable ${targetShell} completion directory found.\n\nTried:\n${triedPaths}\n\n${hint}`,
  )
}

/**
 * Remove an installed completion script.
 *
 * Searches the same candidate directories as `installCompletions` and removes
 * any matching completion files found.
 *
 * @returns The paths that were removed, or empty array if none found.
 */
export async function uninstallCompletions(
  cliName: string,
  shell?: ShellType,
): Promise<string[]> {
  const { existsSync, unlinkSync } = await import('node:fs')
  const { execSync } = await import('node:child_process')
  const { join } = await import('node:path')

  const targetShell = shell ?? detectShell()
  if (!targetShell) {
    throw new Error(
      'Could not detect shell. Set the SHELL environment variable or pass --shell explicitly.',
    )
  }

  let candidates: string[]
  let filename: string

  if (targetShell === 'zsh') {
    filename = `_${cliName}`
    let fpathDirs: string[] = []
    try {
      const fpathOutput = execSync('zsh -c "echo $fpath"', {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim()
      fpathDirs = fpathOutput.split(/\s+/).filter(Boolean)
    } catch {
      // zsh not available
    }
    const seen = new Set<string>()
    candidates = []
    for (const dir of [...fpathDirs, ...ZSH_FPATH_CANDIDATES]) {
      if (!seen.has(dir)) {
        seen.add(dir)
        candidates.push(dir)
      }
    }
  } else {
    filename = cliName
    candidates = [...BASH_COMPLETION_CANDIDATES]
  }

  const removed: string[] = []
  for (const dir of candidates) {
    const filePath = join(dir, filename)
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath)
        removed.push(filePath)
      } catch {
        // Permission denied, skip
      }
    }
  }

  return removed
}
