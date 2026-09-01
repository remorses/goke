import Goke from "./goke.js"
import type { GokeOptions } from "./goke.js"
import { Command } from "./goke.js"
import pc from "./picocolors.js"

/**
 * @param name The program name to display in help and version message
 * @param options Configuration for stdout, stderr, and argv
 */
const goke = (name = '', options?: GokeOptions) => new Goke(name, options)

/**
 * Vendored picocolors instance for terminal colors.
 * Import this instead of installing picocolors, chalk, or any other color library.
 */
export const colors = pc

export default goke
export { goke, Goke, Command }
export { createConsole, GokeProcessExit, openInBrowser, generateDocs, generateCompletionScript, installCompletions, uninstallCompletions, detectShell } from "./goke.js"
export type { GokeOutputStream, GokeConsole, GokeExecutionContext, GokeExecutionContextOverride, GokeFs, GokeOptions, GokeProcess, DocPage, GenerateDocsOptions, ShellType } from "./goke.js"
export type { StandardTypedV1, StandardJSONSchemaV1, JsonSchema } from "./coerce.js"
export { GokeError, coerceBySchema, extractJsonSchema, wrapJsonSchema, isStandardSchema, extractSchemaMetadata } from "./coerce.js"
export { detectAgent, agentInfo, agent, isAgent } from "./agents.js"
export type { AgentName, AgentInfo } from "./agents.js"
export type { DaemonContext, DaemonStartOptions, DaemonStartupMessageOptions } from "./daemon.js"
