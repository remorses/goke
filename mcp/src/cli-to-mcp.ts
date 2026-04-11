/**
 * CLI to MCP adapter.
 *
 * Exposes goke commands as MCP tools on either a low-level Server
 * or a high-level McpServer by mounting tools/list + tools/call handlers.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  coerceBySchema,
  extractJsonSchema,
  GokeProcessExit,
  type Command,
  type Goke,
  type GokeExecutionContext,
  type GokeOutputStream,
  type StandardJSONSchemaV1,
} from "goke";

const CLI_TO_MCP_STATE = Symbol.for("@goke/mcp/cli-to-mcp-state");

interface CommandArgLike {
  required: boolean;
  value: string;
  variadic: boolean;
}

interface OptionLike {
  name: string;
  description: string;
  default?: unknown;
  required?: boolean;
  isBoolean?: boolean;
  schema?: StandardJSONSchemaV1;
}

interface OptionBinding {
  name: string;
  defaultValue?: unknown;
  jsonSchema?: Record<string, unknown>;
}

interface CliToolBinding {
  tool: Tool;
  command: Command;
  /**
   * The goke cli that owns this command. Used at tool-call time to
   * build a `GokeExecutionContext` (console/fs/process) via
   * `cli.createExecutionContext(override)` so actions receive the same
   * injected context they would when invoked from the command line.
   */
  cli: Goke;
  positionalArgs: CommandArgLike[];
  options: OptionBinding[];
  requiredNames: string[];
}

/**
 * A `GokeOutputStream` that accumulates writes into a string.
 *
 * Used to capture what an action writes through `ctx.console.log` /
 * `ctx.console.error` / `ctx.process.stdout` / `ctx.process.stderr`
 * so it can be surfaced in the MCP `CallToolResult.content` instead of
 * leaking into the host process stdout (which, for the stdio MCP
 * transport, is the JSON-RPC channel itself).
 */
interface TextCaptureStream extends GokeOutputStream {
  readonly text: string;
}

function createTextCaptureStream(): TextCaptureStream {
  const chunks: string[] = [];
  return {
    get text() {
      return chunks.join("");
    },
    write(data: string) {
      chunks.push(data);
    },
  };
}

interface CliToMcpState {
  toolsByName: Map<string, CliToolBinding>;
  commandToToolName: Map<string, string>;
}

type AnyRequestHandler = (request: unknown, extra: unknown) => unknown | Promise<unknown>;

function isMountableCommand(command: Command, commandFilter?: (commandName: string) => boolean): boolean {
  if (!command.commandAction) {
    return false;
  }

  if (command.name === "") {
    return false;
  }

  if (commandFilter && !commandFilter(command.name)) {
    return false;
  }

  return true;
}

export interface AddCliToolsToMcpOptions {
  cli: Goke;
  server: Server | McpServer;
  commandFilter?: (commandName: string) => boolean;
  sanitizeToolName?: (commandName: string) => string;
}

function isMcpServer(value: Server | McpServer): value is McpServer {
  return "server" in value;
}

function resolveServer(value: Server | McpServer): Server {
  if (isMcpServer(value)) {
    return value.server;
  }
  return value;
}

function getToolCallArguments(args: Record<string, unknown>, name: string): unknown {
  if (name in args) {
    return args[name];
  }

  const parts = name.split(".");
  let current: unknown = args;
  for (const part of parts) {
    if (current != null && typeof current === "object" && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function setDotProp(target: Record<string, unknown>, keys: string[], value: unknown): void {
  let current: Record<string, unknown> = target;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (i === keys.length - 1) {
      current[key] = value;
      return;
    }

    const existing = current[key];
    if (existing != null && typeof existing === "object" && !Array.isArray(existing)) {
      current = existing as Record<string, unknown>;
      continue;
    }

    const next: Record<string, unknown> = {};
    current[key] = next;
    current = next;
  }
}

function defaultSanitizeToolName(commandName: string): string {
  let name = commandName.trim();
  name = name.replace(/\s+/g, "_");
  name = name.replace(/[^A-Za-z0-9._-]/g, "_");
  name = name.replace(/_+/g, "_");
  name = name.replace(/^[._-]+|[._-]+$/g, "");

  if (!name) {
    name = "tool";
  }

  if (name.length > 128) {
    name = name.slice(0, 128);
  }

  return name;
}

function uniqueToolName(baseName: string, usedNames: Set<string>): string {
  if (!usedNames.has(baseName)) {
    return baseName;
  }

  for (let i = 2; i < 10_000; i++) {
    const suffix = `_${i}`;
    const prefixMax = 128 - suffix.length;
    const candidate = `${baseName.slice(0, Math.max(1, prefixMax))}${suffix}`;
    if (!usedNames.has(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to generate a unique MCP tool name for ${baseName}`);
}

function normalizeOptionSchema(option: OptionLike): { schema: Record<string, unknown>; jsonSchema?: Record<string, unknown> } {
  const schemaFromOption = option.schema ? extractJsonSchema(option.schema) : undefined;
  const schema: Record<string, unknown> = schemaFromOption ? { ...schemaFromOption } : {
    type: option.isBoolean ? "boolean" : "string",
  };

  if (typeof schema.description !== "string" && option.description) {
    schema.description = option.description;
  }
  if (schema.default === undefined && option.default !== undefined) {
    schema.default = option.default;
  }

  return { schema, jsonSchema: schemaFromOption };
}

function commandDescription(command: Command): string {
  const description = command.description.trim();
  if (description) {
    return description;
  }
  return `Run CLI command ${command.name}`;
}

function formatTextResult(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toCallToolResult(value: unknown): CallToolResult {
  if (value && typeof value === "object" && "content" in value) {
    return value as CallToolResult;
  }

  return {
    content: [{
      type: "text",
      text: formatTextResult(value),
    }],
  };
}

function getExistingRequestHandler(server: Server, method: string): AnyRequestHandler | undefined {
  const handlerMap = (server as unknown as { _requestHandlers?: unknown })._requestHandlers;
  if (!(handlerMap instanceof Map)) {
    return undefined;
  }
  return (handlerMap as Map<string, AnyRequestHandler>).get(method);
}

function isToolNotFoundError(error: unknown, toolName: string): boolean {
  if (!(error instanceof McpError)) {
    return false;
  }

  if (error.code !== ErrorCode.InvalidParams) {
    return false;
  }

  const message = String(error.message).toLowerCase();
  return message.includes("tool") && message.includes("not found") && message.includes(toolName.toLowerCase());
}

function isToolNotFoundResult(result: unknown, toolName: string): boolean {
  if (!result || typeof result !== "object") {
    return false;
  }

  const maybe = result as { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
  if (!maybe.isError || !Array.isArray(maybe.content)) {
    return false;
  }

  const textBlock = maybe.content.find((entry) => entry?.type === "text");
  const text = String(textBlock?.text ?? "").toLowerCase();
  return text.includes("tool") && text.includes("not found") && text.includes(toolName.toLowerCase());
}

/**
 * Build the same `GokeExecutionContext` an action would receive from
 * `cli.parse()`, but with capture streams for stdout/stderr and an
 * `exit` that throws `GokeProcessExit` instead of killing the host
 * process.
 *
 * Capturing is required for the stdio MCP transport because the host
 * `process.stdout` is the JSON-RPC channel — any write to it would
 * corrupt the protocol. Capturing is also what lets us surface
 * `ctx.console.log` output in the `CallToolResult.content`.
 */
function createCallToolExecutionContext(cli: Goke): {
  ctx: GokeExecutionContext;
  stdout: TextCaptureStream;
  stderr: TextCaptureStream;
} {
  const stdout = createTextCaptureStream();
  const stderr = createTextCaptureStream();
  const ctx = cli.createExecutionContext({
    stdout,
    stderr,
    // Swallow the user-level exit: the outer createExecutionContext
    // wrapper will still throw `GokeProcessExit` after this returns,
    // which `runCliTool` catches and turns into a `CallToolResult`.
    exit: () => {},
  });
  return { ctx, stdout, stderr };
}

/**
 * Build a `CallToolResult` from an action's return value plus any
 * text that was captured from the injected `ctx.console` /
 * `ctx.process.stdout` / `ctx.process.stderr` streams.
 *
 * Precedence rules:
 *   1. If the action returned a ready-made `CallToolResult` (object
 *      with a `content` key), honor it as-is. Captured output is
 *      ignored to give authors a fully manual escape hatch.
 *   2. If anything was captured on stdout or stderr, emit one text
 *      block per non-empty stream (stdout first, then stderr) and
 *      append the stringified return value as a trailing block when
 *      it is non-empty. This keeps warnings written via
 *      `ctx.console.error` / `ctx.process.stderr.write` from being
 *      silently dropped when the action also returns a value.
 *   3. Otherwise fall back to the legacy behavior (stringify the
 *      return value, empty string when `undefined`).
 */
function buildCallToolResult(
  returnValue: unknown,
  capturedStdout: string,
  capturedStderr: string,
): CallToolResult {
  if (returnValue && typeof returnValue === "object" && "content" in returnValue) {
    return returnValue as CallToolResult;
  }

  if (capturedStdout || capturedStderr) {
    const blocks: Array<{ type: "text"; text: string }> = [];
    if (capturedStdout) {
      blocks.push({ type: "text", text: capturedStdout });
    }
    if (capturedStderr) {
      blocks.push({ type: "text", text: capturedStderr });
    }
    const valueText = formatTextResult(returnValue);
    if (valueText) {
      blocks.push({ type: "text", text: valueText });
    }
    return { content: blocks };
  }

  return toCallToolResult(returnValue);
}

/**
 * Build an error `CallToolResult` from captured output + the process
 * exit code thrown by `ctx.process.exit(code)`. Mirrors the
 * `{ stdout, stderr, exitCode }` shape just-bash produces, but in the
 * MCP content-block format.
 */
function buildProcessExitResult(
  exitCode: number,
  capturedStdout: string,
  capturedStderr: string,
): CallToolResult {
  const content: Array<{ type: "text"; text: string }> = [];
  if (capturedStdout) {
    content.push({ type: "text", text: capturedStdout });
  }
  if (capturedStderr) {
    content.push({ type: "text", text: capturedStderr });
  }
  if (content.length === 0) {
    content.push({ type: "text", text: `Process exited with code ${exitCode}` });
  }
  return {
    isError: exitCode !== 0,
    content,
  };
}

async function runCliTool(binding: CliToolBinding, argumentsObject: Record<string, unknown>): Promise<CallToolResult> {
  for (const requiredName of binding.requiredNames) {
    if (getToolCallArguments(argumentsObject, requiredName) === undefined) {
      throw new McpError(ErrorCode.InvalidParams, `Missing required argument: ${requiredName}`);
    }
  }

  const positionalValues: unknown[] = [];
  for (const arg of binding.positionalArgs) {
    const value = getToolCallArguments(argumentsObject, arg.value);

    if (arg.variadic) {
      if (value === undefined) {
        positionalValues.push([]);
      } else if (Array.isArray(value)) {
        positionalValues.push(value.map((entry) => String(entry)));
      } else {
        positionalValues.push([String(value)]);
      }
    } else {
      positionalValues.push(value === undefined ? undefined : String(value));
    }
  }

  const optionsObject: Record<string, unknown> = {};
  for (const option of binding.options) {
    let optionValue = getToolCallArguments(argumentsObject, option.name);
    if (optionValue === undefined && option.defaultValue !== undefined) {
      optionValue = option.defaultValue;
    }

    if (optionValue !== undefined && option.jsonSchema) {
      const isStringArray = Array.isArray(optionValue) && optionValue.every((value) => typeof value === "string");
      const isCoercibleType = typeof optionValue === "string" || typeof optionValue === "boolean" || isStringArray;
      if (isCoercibleType) {
        optionValue = coerceBySchema(optionValue as string | boolean | string[], option.jsonSchema, option.name);
      }
    }

    if (optionValue !== undefined) {
      setDotProp(optionsObject, option.name.split("."), optionValue);
    }
  }

  const action = binding.command.commandAction;
  if (!action) {
    throw new McpError(ErrorCode.InvalidParams, `Command ${binding.command.name} has no action`);
  }

  // Build the same execution context an action would see when invoked
  // from the command line, but with capture streams + a no-op `exit`
  // so tool calls can't corrupt the MCP transport or kill the host.
  const { ctx, stdout, stderr } = createCallToolExecutionContext(binding.cli);

  try {
    // Match `Goke#runMatchedCommand` by calling the action with the
    // owning cli as `this`. Keeps behavior parity for JS authors who
    // reference `this.name` / `this.options` from inside an action.
    const result = await Promise.resolve(
      action.apply(binding.cli, [...positionalValues, optionsObject, ctx]),
    );
    return buildCallToolResult(result, stdout.text, stderr.text);
  } catch (error) {
    if (error instanceof GokeProcessExit) {
      return buildProcessExitResult(error.code, stdout.text, stderr.text);
    }
    const message = error instanceof Error ? error.message : String(error);
    const content: Array<{ type: "text"; text: string }> = [
      { type: "text", text: message },
    ];
    if (stderr.text) {
      content.push({ type: "text", text: stderr.text });
    }
    return {
      isError: true,
      content,
    };
  }
}

function createBinding(cli: Goke, command: Command, toolName: string): CliToolBinding {
  const positionalArgs = command.args as unknown as CommandArgLike[];
  const options = command.options as unknown as OptionLike[];

  const properties: Record<string, Record<string, unknown>> = {};
  const requiredNames: string[] = [];
  const optionBindings: OptionBinding[] = [];

  for (const arg of positionalArgs) {
    if (arg.variadic) {
      properties[arg.value] = {
        type: "array",
        items: { type: "string" },
        description: `Positional argument ${arg.value}`,
      };
    } else {
      properties[arg.value] = {
        type: "string",
        description: `Positional argument ${arg.value}`,
      };
    }

    if (arg.required) {
      requiredNames.push(arg.value);
    }
  }

  for (const option of options) {
    const normalized = normalizeOptionSchema(option);
    properties[option.name] = normalized.schema;

    if (option.required) {
      requiredNames.push(option.name);
    }

    optionBindings.push({
      name: option.name,
      defaultValue: option.default,
      jsonSchema: normalized.jsonSchema,
    });
  }

  const inputSchema: Tool["inputSchema"] = {
    type: "object",
    properties,
    ...(requiredNames.length > 0 ? { required: Array.from(new Set(requiredNames)) } : {}),
  };

  return {
    tool: {
      name: toolName,
      description: commandDescription(command),
      inputSchema,
    },
    command,
    cli,
    positionalArgs,
    options: optionBindings,
    requiredNames: Array.from(new Set(requiredNames)),
  };
}

function getOrInstallState(server: Server): CliToMcpState {
  const serverWithState = server as Server & { [CLI_TO_MCP_STATE]?: CliToMcpState };
  const existing = serverWithState[CLI_TO_MCP_STATE];
  if (existing) {
    return existing;
  }

  const existingListHandler = getExistingRequestHandler(server, "tools/list");
  const existingCallHandler = getExistingRequestHandler(server, "tools/call");

  if (!existingListHandler && !existingCallHandler) {
    server.registerCapabilities({ tools: { listChanged: true } });
  }

  const state: CliToMcpState = {
    toolsByName: new Map(),
    commandToToolName: new Map(),
  };

  server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const localTools = Array.from(state.toolsByName.values()).map((binding) => binding.tool);
    if (!existingListHandler) {
      return { tools: localTools };
    }

    const previousResult = await Promise.resolve(existingListHandler(request, extra)) as {
      tools?: Tool[];
      nextCursor?: string;
    };

    const merged = new Map<string, Tool>();
    for (const tool of previousResult.tools ?? []) {
      merged.set(tool.name, tool);
    }
    for (const tool of localTools) {
      if (!merged.has(tool.name)) {
        merged.set(tool.name, tool);
      }
    }

    return {
      ...previousResult,
      tools: Array.from(merged.values()),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const binding = state.toolsByName.get(request.params.name);
    const argumentsObject = request.params.arguments ?? {};

    if (existingCallHandler) {
      try {
        const existingResult = await Promise.resolve(existingCallHandler(request, extra)) as CallToolResult;
        if (binding && isToolNotFoundResult(existingResult, request.params.name)) {
          return runCliTool(binding, argumentsObject);
        }
        return existingResult;
      } catch (error) {
        if (!binding || !isToolNotFoundError(error, request.params.name)) {
          throw error;
        }
      }
    }

    if (!binding) {
      throw new McpError(ErrorCode.InvalidParams, `Tool ${request.params.name} not found`);
    }

    return runCliTool(binding, argumentsObject);
  });

  Object.defineProperty(serverWithState, CLI_TO_MCP_STATE, {
    value: state,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return state;
}

export interface CreateMcpActionOptions {
  /** The CLI instance whose commands will be exposed as MCP tools */
  cli: Goke;
  /** Additional filter for which commands to expose. The MCP command itself is always excluded. */
  commandFilter?: (commandName: string) => boolean;
  /** Custom tool name sanitizer */
  sanitizeToolName?: (commandName: string) => string;
  /** MCP server name. Defaults to the CLI name or 'cli-mcp-server' */
  serverName?: string;
  /** MCP server version. Defaults to '1.0.0' */
  serverVersion?: string;
  /** Custom transport factory. Defaults to StdioServerTransport (stdin/stdout). */
  createTransport?: () => Transport | Promise<Transport>;
}

/**
 * Create a goke action callback that starts an MCP server over stdio.
 *
 * Exposes all CLI commands as MCP tools, automatically excluding the
 * command this action is attached to.
 *
 * @example
 * ```ts
 * cli.command('mcp', 'Start MCP server over stdio')
 *   .action(createMcpAction({ cli }))
 * ```
 */
export function createMcpAction(options: CreateMcpActionOptions): (...args: any[]) => Promise<void> {
  const { cli, commandFilter: userFilter, sanitizeToolName, serverName, serverVersion, createTransport } = options;

  return async () => {
    // At call time, goke has already matched the command and set matchedCommandName.
    // We use it to auto-exclude the MCP command itself from the tool list.
    const mcpCommandName = cli.matchedCommandName;

    const { Server: ServerClass } = await import("@modelcontextprotocol/sdk/server/index.js");

    const server = new ServerClass(
      {
        name: serverName || cli.name || "cli-mcp-server",
        version: serverVersion || "1.0.0",
      },
      { capabilities: {} },
    );

    addCliToolsToMcp({
      cli,
      server,
      commandFilter: (name) => {
        if (mcpCommandName && name === mcpCommandName) return false;
        return userFilter ? userFilter(name) : true;
      },
      sanitizeToolName,
    });

    let transport: Transport;
    if (createTransport) {
      transport = await createTransport();
    } else {
      const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
      transport = new StdioServerTransport();
    }

    await server.connect(transport);
  };
}

export function addCliToolsToMcp(options: AddCliToolsToMcpOptions): void {
  const { cli, commandFilter, sanitizeToolName = defaultSanitizeToolName } = options;
  const server = resolveServer(options.server);
  const state = getOrInstallState(server);
  const usedNames = new Set(state.toolsByName.keys());

  const activeCommandNames = new Set<string>();
  for (const command of cli.commands) {
    if (isMountableCommand(command, commandFilter)) {
      activeCommandNames.add(command.name);
    }
  }

  for (const [commandName, toolName] of state.commandToToolName) {
    if (!activeCommandNames.has(commandName)) {
      state.commandToToolName.delete(commandName);
      state.toolsByName.delete(toolName);
      usedNames.delete(toolName);
    }
  }

  for (const command of cli.commands) {
    if (!isMountableCommand(command, commandFilter)) {
      continue;
    }

    const existingToolName = state.commandToToolName.get(command.name);
    if (existingToolName) {
      state.toolsByName.delete(existingToolName);
      state.commandToToolName.delete(command.name);
      usedNames.delete(existingToolName);
    }

    const baseToolName = defaultSanitizeToolName(sanitizeToolName(command.name));
    const toolName = uniqueToolName(baseToolName, usedNames);
    usedNames.add(toolName);

    const binding = createBinding(cli, command, toolName);
    state.toolsByName.set(toolName, binding);
    state.commandToToolName.set(command.name, toolName);
  }
}
