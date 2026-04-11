/**
 * End-to-end tests for exposing a goke CLI as MCP tools.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import { goke, wrapJsonSchema, type Goke } from "goke";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { addCliToolsToMcp } from "../cli-to-mcp.js";

function createCli() {
  const cli = goke("test-cli");

  cli
    .command("say hi", "Say hello")
    .option("--name <name>", z.string().describe("Person to greet"))
    .option("--caps", z.boolean().default(false).describe("Uppercase output"))
    .action((options) => {
      const message = `Hello ${options.name}!`;
      return options.caps ? message.toUpperCase() : message;
    });

  // sum-values uses wrapJsonSchema whose output is `unknown`, so values are
  // cast with Number() inside the action.
  cli
    .command("sum-values", "Add two numbers")
    .option(
      "--left <left>",
      wrapJsonSchema({
        type: "number",
        description: "Left operand",
      }),
    )
    .option(
      "--right <right>",
      wrapJsonSchema({
        type: "number",
        description: "Right operand",
      }),
    )
    .action((options) => ({
      sum: Number(options.left) + Number(options.right),
    }));

  cli
    .command("echo <message>", "Echo positional message")
    .option(
      "--repeat [repeat]",
      wrapJsonSchema({
        type: "integer",
        default: 2,
        description: "Repeat count",
      }),
    )
    .action((message, options) => {
      return message.repeat(Number(options.repeat));
    });

  cli
    .command("string-options", "Infer option types from plain string descriptions")
    .option("--title <title>", "Required title")
    .option("--tag [tag]", "Optional tag")
    .option("--dry-run", "Dry run flag")
    .action((options) => {
      return options;
    });

  return cli;
}

function firstTextContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = "content" in result ? (result as { content: Array<{ type: string; text?: string }> }).content : [];
  return content.find((entry) => entry.type === "text")?.text ?? "";
}

function expectCommandDescriptions(tools: Array<{ name: string; description?: string }>): void {
  const descriptionByName = Object.fromEntries(tools.map((tool) => [tool.name, tool.description]));

  expect(descriptionByName).toMatchObject({
    say_hi: "Say hello",
    "sum-values": "Add two numbers",
    echo: "Echo positional message",
    "string-options": "Infer option types from plain string descriptions",
  });
}

function addUserLowLevelTools(server: Server): void {
  server.registerCapabilities({ tools: { listChanged: true } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: "user_tool",
        description: "Tool added directly by user",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "user_tool") {
      throw new McpError(ErrorCode.InvalidParams, `Tool ${request.params.name} not found`);
    }
    return {
      content: [{ type: "text", text: "from-user-low-level" }],
    };
  });
}

async function runScenario(
  mode: "low-level-server" | "mcp-server",
): Promise<{
  tools: Array<{ name: string; description?: string }>;
  greeting: string;
  sum: string;
  echo: string;
  stringOptions: string;
}> {
  const cli = createCli();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const server = mode === "low-level-server"
    ? new Server({ name: "test-server", version: "1.0.0" }, { capabilities: {} })
    : new McpServer({ name: "test-server", version: "1.0.0" });

  addCliToolsToMcp({ cli, server });

  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const toolsResult = await client.listTools();

    const greetingResult = await client.callTool({
      name: "say_hi",
      arguments: { name: "Tommy" },
    });

    const sumResult = await client.callTool({
      name: "sum-values",
      arguments: { left: 2, right: 3 },
    });

    const echoResult = await client.callTool({
      name: "echo",
      arguments: { message: "ha" },
    });

    const stringOptionsResult = await client.callTool({
      name: "string-options",
      arguments: {
        title: "Release notes",
        dryRun: true,
      },
    });

    return {
      tools: toolsResult.tools,
      greeting: firstTextContent(greetingResult),
      sum: firstTextContent(sumResult),
      echo: firstTextContent(echoResult),
      stringOptions: firstTextContent(stringOptionsResult),
    };
  } finally {
    await client.close();
    await server.close();
  }
}

describe("addCliToolsToMcp", () => {
  it("mounts CLI tools and executes calls with low-level Server", async () => {
    const result = await runScenario("low-level-server");

    expect("\n" + JSON.stringify(result.tools, null, 2)).toMatchInlineSnapshot(`
      "
      [
        {
          "name": "say_hi",
          "description": "Say hello",
          "inputSchema": {
            "type": "object",
            "properties": {
              "name": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "string",
                "description": "Person to greet"
              },
              "caps": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "default": false,
                "description": "Uppercase output",
                "type": "boolean"
              }
            },
            "required": [
              "name"
            ]
          }
        },
        {
          "name": "sum-values",
          "description": "Add two numbers",
          "inputSchema": {
            "type": "object",
            "properties": {
              "left": {
                "type": "number",
                "description": "Left operand"
              },
              "right": {
                "type": "number",
                "description": "Right operand"
              }
            },
            "required": [
              "left",
              "right"
            ]
          }
        },
        {
          "name": "echo",
          "description": "Echo positional message",
          "inputSchema": {
            "type": "object",
            "properties": {
              "message": {
                "type": "string",
                "description": "Positional argument message"
              },
              "repeat": {
                "type": "integer",
                "default": 2,
                "description": "Repeat count"
              }
            },
            "required": [
              "message"
            ]
          }
        },
        {
          "name": "string-options",
          "description": "Infer option types from plain string descriptions",
          "inputSchema": {
            "type": "object",
            "properties": {
              "title": {
                "type": "string",
                "description": "Required title"
              },
              "tag": {
                "type": "string",
                "description": "Optional tag"
              },
              "dryRun": {
                "type": "boolean",
                "description": "Dry run flag"
              }
            },
            "required": [
              "title"
            ]
          }
        }
      ]"
    `);

    expectCommandDescriptions(result.tools);

    expect(result.greeting).toBe("Hello Tommy!");
    expect(result.sum).toBe('{\n  "sum": 5\n}');
    expect(result.echo).toBe("haha");
    expect(result.stringOptions).toBe('{\n  "title": "Release notes",\n  "dryRun": true\n}');
  });

  it("mounts CLI tools and executes calls with high-level McpServer", async () => {
    const result = await runScenario("mcp-server");

    expect("\n" + JSON.stringify(result.tools, null, 2)).toMatchInlineSnapshot(`
      "
      [
        {
          "name": "say_hi",
          "description": "Say hello",
          "inputSchema": {
            "type": "object",
            "properties": {
              "name": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "string",
                "description": "Person to greet"
              },
              "caps": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "default": false,
                "description": "Uppercase output",
                "type": "boolean"
              }
            },
            "required": [
              "name"
            ]
          }
        },
        {
          "name": "sum-values",
          "description": "Add two numbers",
          "inputSchema": {
            "type": "object",
            "properties": {
              "left": {
                "type": "number",
                "description": "Left operand"
              },
              "right": {
                "type": "number",
                "description": "Right operand"
              }
            },
            "required": [
              "left",
              "right"
            ]
          }
        },
        {
          "name": "echo",
          "description": "Echo positional message",
          "inputSchema": {
            "type": "object",
            "properties": {
              "message": {
                "type": "string",
                "description": "Positional argument message"
              },
              "repeat": {
                "type": "integer",
                "default": 2,
                "description": "Repeat count"
              }
            },
            "required": [
              "message"
            ]
          }
        },
        {
          "name": "string-options",
          "description": "Infer option types from plain string descriptions",
          "inputSchema": {
            "type": "object",
            "properties": {
              "title": {
                "type": "string",
                "description": "Required title"
              },
              "tag": {
                "type": "string",
                "description": "Optional tag"
              },
              "dryRun": {
                "type": "boolean",
                "description": "Dry run flag"
              }
            },
            "required": [
              "title"
            ]
          }
        }
      ]"
    `);

    expectCommandDescriptions(result.tools);

    expect(result.greeting).toBe("Hello Tommy!");
    expect(result.sum).toBe('{\n  "sum": 5\n}');
    expect(result.echo).toBe("haha");
    expect(result.stringOptions).toBe('{\n  "title": "Release notes",\n  "dryRun": true\n}');
  });

  it("composes with user tools already mounted on low-level Server", async () => {
    const cli = createCli();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new Server({ name: "test-server", version: "1.0.0" }, { capabilities: {} });
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    addUserLowLevelTools(server);
    addCliToolsToMcp({ cli, server, commandFilter: (name) => name === "say hi" });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["say_hi", "user_tool"]);

      const cliResult = await client.callTool({
        name: "say_hi",
        arguments: { name: "Tommy" },
      });

      const userResult = await client.callTool({
        name: "user_tool",
        arguments: {},
      });

      expect(firstTextContent(cliResult)).toBe("Hello Tommy!");
      expect(firstTextContent(userResult)).toBe("from-user-low-level");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("composes with user tools already mounted on high-level McpServer", async () => {
    const cli = createCli();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: "test-server", version: "1.0.0" });
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    server.tool("user_tool", "Tool added directly by user", async () => ({
      content: [{ type: "text", text: "from-user-mcp-server" }],
    }));

    addCliToolsToMcp({ cli, server, commandFilter: (name) => name === "say hi" });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["say_hi", "user_tool"]);

      const cliResult = await client.callTool({
        name: "say_hi",
        arguments: { name: "Tommy" },
      });

      const userResult = await client.callTool({
        name: "user_tool",
        arguments: {},
      });

      expect(firstTextContent(cliResult)).toBe("Hello Tommy!");
      expect(firstTextContent(userResult)).toBe("from-user-mcp-server");
    } finally {
      await client.close();
      await server.close();
    }
  });
});

/**
 * Spin up a live MCP client/server pair wired to a single cli.
 *
 * Used by the execution-context tests below to keep the boilerplate
 * out of each test body.
 */
async function withMcpClient<T>(
  cli: Goke,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new Server({ name: "test-server", version: "1.0.0" }, { capabilities: {} });
  addCliToolsToMcp({ cli, server });

  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

function textBlocks(result: Awaited<ReturnType<Client["callTool"]>>): string[] {
  const content = "content" in result ? (result as { content: Array<{ type: string; text?: string }> }).content : [];
  return content.filter((entry) => entry.type === "text").map((entry) => entry.text ?? "");
}

describe("addCliToolsToMcp execution context", () => {
  it("passes an execution context as the third argument to the action", async () => {
    const cli = goke("ctx-cli", {
      cwd: "/workspace",
      env: { TOKEN: "abc", USER: "tommy" },
      stdin: "hello from stdin",
    });

    cli.command("inspect-ctx", "Return the injected execution context").action((_options, ctx) => {
      return {
        hasCtx: ctx != null,
        hasConsole: typeof ctx?.console?.log === "function",
        hasFs: typeof ctx?.fs?.readFile === "function",
        cwd: ctx?.process?.cwd,
        token: ctx?.process?.env?.TOKEN,
        user: ctx?.process?.env?.USER,
        stdin: ctx?.process?.stdin,
      };
    });

    const result = await withMcpClient(cli, (client) =>
      client.callTool({ name: "inspect-ctx", arguments: {} }),
    );

    expect(firstTextContent(result)).toMatchInlineSnapshot(`
      "{
        "hasCtx": true,
        "hasConsole": true,
        "hasFs": true,
        "cwd": "/workspace",
        "token": "abc",
        "user": "tommy",
        "stdin": "hello from stdin"
      }"
    `);
  });

  it("captures ctx.console.log output into the tool result content", async () => {
    const cli = goke("logs-cli");

    cli.command("noisy", "Write to ctx.console and return nothing").action((_options, ctx) => {
      ctx.console.log("line one");
      ctx.console.log("line", "two");
    });

    const result = await withMcpClient(cli, (client) =>
      client.callTool({ name: "noisy", arguments: {} }),
    );

    expect(textBlocks(result)).toMatchInlineSnapshot(`
      [
        "line one
      line two
      ",
      ]
    `);
  });

  it("captures ctx.console.log output and still uses the action's return value", async () => {
    const cli = goke("logs-plus-return-cli");

    cli.command("both", "Log and return").action((_options, ctx) => {
      ctx.console.log("before");
      return "the-return-value";
    });

    const result = await withMcpClient(cli, (client) =>
      client.callTool({ name: "both", arguments: {} }),
    );

    // Captured stdout first, then the stringified return value, as
    // separate content blocks. Authors who want a single block can
    // return a `{ content }` object to bypass this merging.
    expect(textBlocks(result)).toMatchInlineSnapshot(`
      [
        "before
      ",
        "the-return-value",
      ]
    `);
  });

  it("treats ctx.process.exit(0) as a success result with captured content", async () => {
    const cli = goke("exit-ok-cli");

    cli.command("exit-ok", "Exit cleanly").action((_options, ctx) => {
      ctx.console.log("all good");
      ctx.process.exit(0);
    });

    const result = await withMcpClient(cli, (client) =>
      client.callTool({ name: "exit-ok", arguments: {} }),
    );

    expect(result.isError).toBeFalsy();
    expect(textBlocks(result)).toMatchInlineSnapshot(`
      [
        "all good
      ",
      ]
    `);
  });

  it("treats ctx.process.exit(1) as an isError result with captured stderr", async () => {
    const cli = goke("exit-fail-cli");

    cli.command("exit-fail", "Exit with error").action((_options, ctx) => {
      ctx.console.error("boom");
      ctx.process.exit(1);
    });

    const result = await withMcpClient(cli, (client) =>
      client.callTool({ name: "exit-fail", arguments: {} }),
    );

    expect(result.isError).toBe(true);
    expect(textBlocks(result)).toMatchInlineSnapshot(`
      [
        "boom
      ",
      ]
    `);
  });

  it("does not corrupt the MCP transport when the action writes to ctx.process.stdout directly", async () => {
    const cli = goke("stdout-cli");

    cli.command("write-stdout", "Write through ctx.process.stdout").action((_options, ctx) => {
      ctx.process.stdout.write("from-process-stdout\n");
    });

    const result = await withMcpClient(cli, (client) =>
      client.callTool({ name: "write-stdout", arguments: {} }),
    );

    expect(firstTextContent(result)).toBe("from-process-stdout\n");
  });

  it("keeps the server alive after a tool action calls ctx.process.exit", async () => {
    const cli = goke("survive-cli");

    cli.command("boom", "Exit with non-zero code").action((_options, ctx) => {
      ctx.process.exit(2);
    });

    cli.command("ping", "Return a value").action(() => "pong");

    await withMcpClient(cli, async (client) => {
      const boomResult = await client.callTool({ name: "boom", arguments: {} });
      expect(boomResult.isError).toBe(true);

      // Server must still be able to serve subsequent tool calls.
      const pingResult = await client.callTool({ name: "ping", arguments: {} });
      expect(firstTextContent(pingResult)).toBe("pong");
    });
  });

  it("does not include captured content when the action returns a ready-made CallToolResult", async () => {
    const cli = goke("raw-cli");

    cli.command("raw", "Return a raw CallToolResult").action((_options, ctx) => {
      // This write should be ignored — returning a {content} object is
      // the explicit escape hatch for authors who want full control.
      ctx.console.log("ignored-capture");
      return {
        content: [
          { type: "text" as const, text: "authoritative" },
        ],
      };
    });

    const result = await withMcpClient(cli, (client) =>
      client.callTool({ name: "raw", arguments: {} }),
    );

    expect(textBlocks(result)).toEqual(["authoritative"]);
  });

  it("captures ctx.console.error output on the success path", async () => {
    const cli = goke("success-stderr-cli");

    cli.command("warn-and-return", "Emit a warning and return a value").action((_options, ctx) => {
      ctx.console.error("something suspicious");
      return { ok: true };
    });

    const result = await withMcpClient(cli, (client) =>
      client.callTool({ name: "warn-and-return", arguments: {} }),
    );

    // Captured stderr lands in its own text block so authors can spot
    // the warning even though the action returned successfully. The
    // stringified return value is appended after it.
    expect(result.isError).toBeFalsy();
    expect(textBlocks(result)).toMatchInlineSnapshot(`
      [
        "something suspicious
      ",
        "{
        "ok": true
      }",
      ]
    `);
  });

  it("captures ctx.process.stderr.write output on the success path", async () => {
    const cli = goke("success-stderr-write-cli");

    cli.command("warn-only", "Write to stderr and return undefined").action((_options, ctx) => {
      ctx.process.stderr.write("low-level-warning\n");
    });

    const result = await withMcpClient(cli, (client) =>
      client.callTool({ name: "warn-only", arguments: {} }),
    );

    expect(result.isError).toBeFalsy();
    expect(textBlocks(result)).toEqual(["low-level-warning\n"]);
  });

  it("does not leak tool output into the cli's configured stdout/stderr", async () => {
    const sentinelStdout: string[] = [];
    const sentinelStderr: string[] = [];
    const cli = goke("sentinel-cli", {
      stdout: { write: (data) => { sentinelStdout.push(data); } },
      stderr: { write: (data) => { sentinelStderr.push(data); } },
    });

    cli.command("noisy", "Write to both streams").action((_options, ctx) => {
      ctx.console.log("stdout-chatter");
      ctx.console.error("stderr-chatter");
      ctx.process.stdout.write("direct-stdout\n");
      ctx.process.stderr.write("direct-stderr\n");
      return "value";
    });

    const result = await withMcpClient(cli, (client) =>
      client.callTool({ name: "noisy", arguments: {} }),
    );

    // Everything lands in the CallToolResult — the cli's configured
    // host streams must not receive a single byte during a tool call.
    expect(sentinelStdout.join("")).toBe("");
    expect(sentinelStderr.join("")).toBe("");
    expect(textBlocks(result).join("|")).toBe(
      "stdout-chatter\ndirect-stdout\n|stderr-chatter\ndirect-stderr\n|value",
    );
  });

  it("invokes command actions with the owning cli as `this`", async () => {
    const cli = goke("this-binding-cli");

    let seenThis: unknown;
    cli.command("whoami", "Report this-binding").action(function (this: unknown, _options, _ctx) {
      seenThis = this;
      return "ok";
    });

    await withMcpClient(cli, (client) =>
      client.callTool({ name: "whoami", arguments: {} }),
    );

    // Same binding Goke#runMatchedCommand uses for parse-path actions.
    expect(seenThis).toBe(cli);
  });
});
