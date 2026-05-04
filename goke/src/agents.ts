/**
 * AI coding agent detection for goke CLIs.
 *
 * Detects whether the current process is running inside an AI coding agent
 * (Claude, Cursor, Codex, Gemini, etc.) by checking environment variables.
 * Ported from unjs/std-env with the same detection logic.
 *
 * CLI authors can use this to adjust behavior: skip interactive prompts,
 * prefer structured output, avoid browser opens, etc.
 */

const env: Record<string, string | undefined> =
  globalThis.process?.env || Object.create(null)

/**
 * Known AI coding agent names.
 */
export type AgentName =
  | (string & {})
  | 'cursor'
  | 'claude'
  | 'devin'
  | 'replit'
  | 'gemini'
  | 'codex'
  | 'auggie'
  | 'opencode'
  | 'kiro'
  | 'goose'
  | 'pi'

type EnvCheck = string | (() => boolean)

type InternalAgent = [agentName: AgentName, envChecks: EnvCheck[]]

function envMatcher(envKey: string, regex: RegExp) {
  return () => {
    const value = env[envKey]
    return value ? regex.test(value) : false
  }
}

// Detection order matters: specific agents first, IDE-based agents last
// so that agents running inside those IDEs are detected by their own env vars first.
const agents: InternalAgent[] = [
  // CLI agents
  ['claude', ['CLAUDECODE', 'CLAUDE_CODE']],
  ['replit', ['REPL_ID']],
  ['gemini', ['GEMINI_CLI']],
  ['codex', ['CODEX_SANDBOX', 'CODEX_THREAD_ID']],
  ['opencode', ['OPENCODE']],
  ['pi', [envMatcher('PATH', /\.pi[\\/]agent/)]],
  ['auggie', ['AUGMENT_AGENT']],
  ['goose', ['GOOSE_PROVIDER']],

  // IDE-based agents (checked last)
  ['devin', [envMatcher('EDITOR', /devin/)]],
  ['cursor', ['CURSOR_AGENT']],
  ['kiro', [envMatcher('TERM_PROGRAM', /kiro/)]],
]

/**
 * Information about the detected AI coding agent.
 */
export type AgentInfo = {
  /** The name of the detected agent, or undefined if no agent was detected. */
  name?: AgentName
}

/**
 * Detect the current AI coding agent from environment variables.
 *
 * Checks `AI_AGENT` env var first (explicit override), then scans for
 * known agent-specific env vars in priority order.
 *
 * Supported agents: `cursor`, `claude`, `devin`, `replit`, `gemini`,
 * `codex`, `auggie`, `opencode`, `kiro`, `goose`, `pi`
 */
export function detectAgent(): AgentInfo {
  const aiAgent = env.AI_AGENT
  if (aiAgent) {
    return { name: aiAgent.toLowerCase() }
  }
  for (const [name, checks] of agents) {
    for (const check of checks) {
      if (typeof check === 'string' ? env[check] : check()) {
        return { name }
      }
    }
  }
  return {}
}

/** Detected agent info, evaluated once at import time. */
export const agentInfo: AgentInfo = /* #__PURE__ */ detectAgent()

/** Name of the detected agent, or undefined if not running inside one. */
export const agent: AgentName | undefined = agentInfo.name

/** Whether the current process is running inside an AI coding agent. */
export const isAgent: boolean = !!agentInfo.name
