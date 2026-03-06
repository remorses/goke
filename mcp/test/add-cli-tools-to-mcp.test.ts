/**
 * End-to-end tests for exposing a goke CLI as MCP tools.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import { goke, wrapJsonSchema } from "goke";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { addCliToolsToMcp } from "../src/cli-to-mcp.js";

function createCli() {
  const cli = goke("test-cli");

  cli
    .command("say hi", "Say hello")
    .option("--name <name>", z.string().describe("Person to greet"))
    .option("--caps", z.boolean().default(false).describe("Uppercase output"))
    .action((options: { name: string; caps: boolean }) => {
      const message = `Hello ${options.name}!`;
      return options.caps ? message.toUpperCase() : message;
    });

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
    .action((options: { left: number; right: number }) => ({
      sum: options.left + options.right,
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
    .action((message: string, options: { repeat: number }) => {
      return message.repeat(options.repeat);
    });

  cli
    .command("string-options", "Infer option types from plain string descriptions")
    .option("--title <title>", "Required title")
    .option("--tag [tag]", "Optional tag")
    .option("--dry-run", "Dry run flag")
    .action((options: { title: string; tag?: string; dryRun?: boolean }) => {
      return options;
    });

  return cli;
}

function firstTextContent(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.find((entry) => entry.type === "text")?.text ?? "";
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
