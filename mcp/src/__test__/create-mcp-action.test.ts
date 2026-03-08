/**
 * Tests for createMcpAction — turning a CLI into a stdio MCP server.
 *
 * Uses InMemoryTransport (via createTransport option) to avoid actual stdio.
 * Simulates the goke runtime by setting matchedCommandName before calling the action.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { goke, wrapJsonSchema } from "goke";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createMcpAction } from "../cli-to-mcp.js";

function firstTextContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = "content" in result ? (result as { content: Array<{ type: string; text?: string }> }).content : [];
  return content.find((entry) => entry.type === "text")?.text ?? "";
}

describe("createMcpAction", () => {
  it("returns an action function", () => {
    const cli = goke("test");
    const action = createMcpAction({ cli });
    expect(typeof action).toBe("function");
  });

  it("starts an MCP server exposing CLI commands, excluding the mcp command", async () => {
    const cli = goke("test");

    cli
      .command("greet", "Say hello")
      .option("--name <name>", z.string().describe("Person to greet"))
      .action((options: { name: string }) => `Hello ${options.name}!`);

    cli
      .command("add", "Add numbers")
      .option("--a <a>", z.number().describe("First"))
      .option("--b <b>", z.number().describe("Second"))
      .action((options: { a: number; b: number }) => ({ sum: options.a + options.b }));

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    cli.command("mcp", "Start MCP server").action(
      createMcpAction({
        cli,
        createTransport: () => serverTransport,
      }),
    );

    // Simulate goke matching the "mcp" command (normally set by cli.parse())
    cli.matchedCommandName = "mcp";

    // Fire the action — starts the MCP server on the in-memory transport
    const mcpCommand = cli.commands.find((c) => c.name === "mcp")!;
    await mcpCommand.commandAction!({});

    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      const toolNames = tools.tools.map((t) => t.name).sort();
      expect(toolNames).toEqual(["add", "greet"]);

      const greetResult = await client.callTool({
        name: "greet",
        arguments: { name: "World" },
      });
      expect(firstTextContent(greetResult)).toBe("Hello World!");

      const addResult = await client.callTool({
        name: "add",
        arguments: { a: 3, b: 7 },
      });
      expect(firstTextContent(addResult)).toBe('{\n  "sum": 10\n}');
    } finally {
      await client.close();
    }
  });

  it("composes user commandFilter with auto-exclusion", async () => {
    const cli = goke("test");

    cli.command("public-cmd", "Public command").action(() => "public");
    cli.command("secret-cmd", "Secret command").action(() => "secret");

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    cli.command("mcp", "Start MCP server").action(
      createMcpAction({
        cli,
        commandFilter: (name) => name !== "secret-cmd",
        createTransport: () => serverTransport,
      }),
    );

    cli.matchedCommandName = "mcp";

    const mcpCommand = cli.commands.find((c) => c.name === "mcp")!;
    await mcpCommand.commandAction!({});

    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      const toolNames = tools.tools.map((t) => t.name).sort();
      // Both "mcp" (auto-excluded) and "secret-cmd" (user filter) excluded
      expect(toolNames).toEqual(["public-cmd"]);
    } finally {
      await client.close();
    }
  });

  it("works with multi-word command names", async () => {
    const cli = goke("test");

    cli
      .command("db migrate", "Run migrations")
      .action(() => "migrated");

    cli
      .command("db seed", "Seed database")
      .action(() => "seeded");

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    cli.command("serve mcp", "Start MCP server").action(
      createMcpAction({
        cli,
        createTransport: () => serverTransport,
      }),
    );

    cli.matchedCommandName = "serve mcp";

    const mcpCommand = cli.commands.find((c) => c.name === "serve mcp")!;
    await mcpCommand.commandAction!({});

    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      const toolNames = tools.tools.map((t) => t.name).sort();
      expect(toolNames).toEqual(["db_migrate", "db_seed"]);

      const migrateResult = await client.callTool({
        name: "db_migrate",
        arguments: {},
      });
      expect(firstTextContent(migrateResult)).toBe("migrated");
    } finally {
      await client.close();
    }
  });

  it("end-to-end: MCP client connects, discovers tools with schemas, calls tools, handles errors", async () => {
    const cli = goke("my-app");

    // String option command
    cli
      .command("search", "Search for items")
      .option("--query <query>", z.string().describe("Search query"))
      .option("--limit [limit]", z.number().default(10).describe("Max results"))
      .action((options: { query: string; limit: number }) => {
        return { results: [`result for "${options.query}"`], limit: options.limit };
      });

    // Boolean flag + positional arg command
    cli
      .command("deploy <env>", "Deploy to environment")
      .option("--dry-run", z.boolean().default(false).describe("Simulate deployment"))
      .action((env: string, options: { dryRun: boolean }) => {
        return options.dryRun ? `dry-run deploy to ${env}` : `deployed to ${env}`;
      });

    // Command that returns a CallToolResult directly
    cli
      .command("status", "Get system status")
      .action(() => ({
        content: [{ type: "text", text: "all systems operational" }],
      }));

    // Command that throws an error (should be caught and returned as isError)
    cli
      .command("fail", "Always fails")
      .action(() => {
        throw new Error("something went wrong");
      });

    // Wrapped JSON schema command
    cli
      .command("config set", "Set a config value")
      .option("--key <key>", wrapJsonSchema({ type: "string", description: "Config key" }))
      .option("--value <value>", wrapJsonSchema({ type: "string", description: "Config value" }))
      .action((options: { key: string; value: string }) => {
        return `set ${options.key} = ${options.value}`;
      });

    // Commands without actions (should NOT appear as tools)
    cli.command("no-action", "This has no action handler");

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    cli.command("mcp", "Start MCP server").action(
      createMcpAction({
        cli,
        serverName: "my-app-mcp",
        serverVersion: "2.5.0",
        createTransport: () => serverTransport,
      }),
    );

    cli.matchedCommandName = "mcp";

    const mcpCommand = cli.commands.find((c) => c.name === "mcp")!;
    await mcpCommand.commandAction!({});

    const client = new Client({ name: "e2e-test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    try {
      // ── Server info ──
      const serverInfo = client.getServerVersion();
      expect(serverInfo).toMatchObject({ name: "my-app-mcp", version: "2.5.0" });

      // ── Tool discovery ──
      const tools = await client.listTools();
      const toolNames = tools.tools.map((t) => t.name).sort();
      // "mcp" auto-excluded, "no-action" has no handler → not mounted
      expect(toolNames).toEqual(["config_set", "deploy", "fail", "search", "status"]);

      // ── Verify schemas are propagated ──
      const searchTool = tools.tools.find((t) => t.name === "search")!;
      expect(searchTool.description).toBe("Search for items");
      expect(searchTool.inputSchema.properties).toHaveProperty("query");
      expect(searchTool.inputSchema.properties).toHaveProperty("limit");
      expect(searchTool.inputSchema.required).toEqual(["query"]);

      const deployTool = tools.tools.find((t) => t.name === "deploy")!;
      expect(deployTool.inputSchema.properties).toHaveProperty("env");
      expect(deployTool.inputSchema.properties).toHaveProperty("dryRun");
      expect(deployTool.inputSchema.required).toEqual(["env"]);

      // ── Call tool with schema-based options ──
      const searchResult = await client.callTool({
        name: "search",
        arguments: { query: "hello", limit: 5 },
      });
      expect(firstTextContent(searchResult)).toBe(
        '{\n  "results": [\n    "result for \\"hello\\""\n  ],\n  "limit": 5\n}',
      );

      // ── Call tool with positional args ──
      const deployResult = await client.callTool({
        name: "deploy",
        arguments: { env: "production", dryRun: true },
      });
      expect(firstTextContent(deployResult)).toBe("dry-run deploy to production");

      // ── Call tool that returns a raw CallToolResult ──
      const statusResult = await client.callTool({
        name: "status",
        arguments: {},
      });
      expect(firstTextContent(statusResult)).toBe("all systems operational");

      // ── Call tool that throws → error is caught and returned as isError ──
      const failResult = await client.callTool({
        name: "fail",
        arguments: {},
      });
      expect(failResult.isError).toBe(true);
      expect(firstTextContent(failResult)).toBe("something went wrong");

      // ── Call tool with multi-word command name ──
      const configResult = await client.callTool({
        name: "config_set",
        arguments: { key: "theme", value: "dark" },
      });
      expect(firstTextContent(configResult)).toBe("set theme = dark");

      // ── Call nonexistent tool → MCP error ──
      await expect(
        client.callTool({ name: "nonexistent", arguments: {} }),
      ).rejects.toThrow(/not found/i);
    } finally {
      await client.close();
    }
  });

  it("returns empty tool list when only the mcp command exists", async () => {
    const cli = goke("empty-app");

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    cli.command("mcp", "Start MCP server").action(
      createMcpAction({
        cli,
        createTransport: () => serverTransport,
      }),
    );

    cli.matchedCommandName = "mcp";

    const mcpCommand = cli.commands.find((c) => c.name === "mcp")!;
    await mcpCommand.commandAction!({});

    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      expect(tools.tools).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it("exposes all commands when matchedCommandName is not set", async () => {
    const cli = goke("test");

    cli.command("ping", "Ping").action(() => "pong");

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    cli.command("mcp", "Start MCP server").action(
      createMcpAction({
        cli,
        createTransport: () => serverTransport,
      }),
    );

    // Do NOT set matchedCommandName — simulates programmatic invocation
    // without cli.parse(). All commands including "mcp" should be exposed.

    const mcpCommand = cli.commands.find((c) => c.name === "mcp")!;
    await mcpCommand.commandAction!({});

    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      const toolNames = tools.tools.map((t) => t.name).sort();
      // Without matchedCommandName, auto-exclusion can't kick in
      expect(toolNames).toEqual(["mcp", "ping"]);
    } finally {
      await client.close();
    }
  });
});
