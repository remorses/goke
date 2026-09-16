/**
 * Multi-tenant remote-MCP test.
 *
 * Proves that one goke cli exposed over stateless MCP streamable HTTP
 * can serve multiple concurrent users with fully isolated state
 * (in-memory fs + cwd + env) — no shared host process stdio, no
 * cross-tenant leaks, no mcp-session-id map.
 *
 * Wiring choices worth calling out:
 *
 *   - `WebStandardStreamableHTTPServerTransport` from the MCP SDK
 *     accepts a Web-Standard `Request` and returns a `Response`.
 *     That means we can drive it **in-process** through the client
 *     transport's `fetch` hook without ever binding a TCP socket
 *     or spinning up `node:http` / Express. Same wire protocol,
 *     zero sockets.
 *   - `sessionIdGenerator: undefined` is stateless mode. The
 *     transport does not emit or expect `mcp-session-id`. Each
 *     POST builds a fresh Server + transport, then closes them.
 *   - `enableJsonResponse: true` switches the transport off SSE
 *     and into pure request/response JSON. GET SSE opens are
 *     answered with `405`, which the client treats as "server
 *     does not offer SSE" and moves on (see `_startOrAuthSse`
 *     in the SDK client).
 *   - Each request gets its own cli **clone** via
 *     `baseCli.clone({ cwd, env, fs })`. The clone inherits the
 *     command tree but owns its own `{ cwd, env, fs }`, which is
 *     what `runCliTool` forwards into every action through
 *     `ctx.process.*` / `ctx.fs`.
 */

import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server as McpLowLevelServer } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { goke, type Goke, type GokeFs } from "goke";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { addCliToolsToMcp } from "../cli-to-mcp.js";

// ─── Minimal in-memory fs ─────────────────────────────────────────

/**
 * Dead-simple `GokeFs` backed by a `Map<string, string>`.
 *
 * Implements only the methods the cli commands in this test
 * actually call (`writeFile`, `readFile`, `mkdir`). Every other
 * method throws so accidental real-fs usage would fail loudly.
 */
const notImplemented = (name: string) => () => {
  throw new Error(`InMemoryFs.${name} not implemented for this test`);
};

class InMemoryFs implements GokeFs {
  readonly files = new Map<string, string>();

  writeFile: GokeFs["writeFile"] = async (filePath, data) => {
    const key = String(filePath);
    const text = typeof data === "string"
      ? data
      : new TextDecoder("utf-8").decode(data);
    this.files.set(key, text);
  };

  readFile: GokeFs["readFile"] = async (filePath) => {
    const key = String(filePath);
    const content = this.files.get(key);
    if (content === undefined) {
      throw new Error(`ENOENT: ${key}`);
    }
    return content;
  };

  mkdir: GokeFs["mkdir"] = async () => undefined;

  appendFile: GokeFs["appendFile"] = notImplemented("appendFile");
  chmod: GokeFs["chmod"] = notImplemented("chmod");
  copyFile: GokeFs["copyFile"] = notImplemented("copyFile");
  link: GokeFs["link"] = notImplemented("link");
  readlink: GokeFs["readlink"] = notImplemented("readlink");
  realpath: GokeFs["realpath"] = notImplemented("realpath");
  rename: GokeFs["rename"] = notImplemented("rename");
  rm: GokeFs["rm"] = notImplemented("rm");
  symlink: GokeFs["symlink"] = notImplemented("symlink");
  utimes: GokeFs["utimes"] = notImplemented("utimes");
}

// ─── Shared cli definition ────────────────────────────────────────

/**
 * One cli definition, reused across tenants. Commands read / write
 * through `ctx.fs` and resolve paths against `ctx.process.cwd`, so
 * the *same* code runs per tenant but talks to a tenant-specific
 * filesystem when invoked via the per-request clone below.
 */
function buildBaseCli(): Goke {
  const cli = goke("notes-app");

  cli
    .command("save <filename>", "Save content to a file in the tenant workspace")
    .option("--content <content>", z.string().describe("File content"))
    .action(async (filename: string, options: { content: string }, ctx) => {
      const full = path.posix.join(ctx.process.cwd, filename);
      await ctx.fs.writeFile(full, options.content);
      return { saved: full, tenant: ctx.process.env.TENANT_ID };
    });

  cli
    .command("load <filename>", "Read a file from the tenant workspace")
    .action(async (filename: string, _options, ctx) => {
      const full = path.posix.join(ctx.process.cwd, filename);
      const text = await ctx.fs.readFile(full, "utf8");
      return { path: full, text, tenant: ctx.process.env.TENANT_ID };
    });

  return cli;
}

// ─── In-process multi-tenant fetch ────────────────────────────────

/**
 * Per-tenant state resolved from the `x-tenant-id` header on every
 * POST. Each tenant gets its own cwd, env, and in-memory fs.
 */
interface TenantState {
  cwd: string;
  env: Record<string, string>;
  fs: InMemoryFs;
}

/**
 * Build a `FetchLike` that handles each MCP POST with a fresh
 * `WebStandardStreamableHTTPServerTransport` and cli clone.
 * Tenant identity comes from `x-tenant-id` on every request.
 * Nothing is keyed by `mcp-session-id`.
 */
function createMultiTenantFetch(options: {
  baseCli: Goke;
  resolveTenant: (tenantId: string) => TenantState;
}): { fetch: FetchLike } {
  const { baseCli, resolveTenant } = options;

  const customFetch: FetchLike = async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);

    if (method !== "POST") {
      return new Response(null, { status: 405 });
    }

    let parsedBody: unknown = undefined;
    if (init?.body != null) {
      const rawBody = init.body;
      const bodyText = typeof rawBody === "string"
        ? rawBody
        : await new Response(rawBody).text();
      if (bodyText) {
        parsedBody = JSON.parse(bodyText);
      }
    }

    const request = new Request(url.toString(), {
      method,
      headers,
    });

    const tenantId = headers.get("x-tenant-id");
    if (!tenantId) {
      return new Response("missing x-tenant-id header", { status: 401 });
    }
    const tenant = resolveTenant(tenantId);

    const tenantCli = baseCli.clone({
      cwd: tenant.cwd,
      env: { ...tenant.env, TENANT_ID: tenantId },
      fs: tenant.fs,
    });

    const mcpServer = new McpLowLevelServer(
      { name: "notes-app-mcp", version: "1.0.0" },
      { capabilities: {} },
    );
    addCliToolsToMcp({ cli: tenantCli, server: mcpServer });

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await mcpServer.connect(transport);
    try {
      return await transport.handleRequest(request, { parsedBody });
    } finally {
      await transport.close();
      await mcpServer.close();
    }
  };

  return { fetch: customFetch };
}

// ─── Tests ────────────────────────────────────────────────────────

describe("remote MCP over streamable HTTP with multi-tenant in-memory fs", () => {
  function setupScenario() {
    const baseCli = buildBaseCli();
    const tenants = new Map<string, TenantState>();
    tenants.set("tenant-a", {
      cwd: "/workspace-a",
      env: { ROLE: "writer" },
      fs: new InMemoryFs(),
    });
    tenants.set("tenant-b", {
      cwd: "/workspace-b",
      env: { ROLE: "reader" },
      fs: new InMemoryFs(),
    });

    const { fetch: tenantFetch } = createMultiTenantFetch({
      baseCli,
      resolveTenant: (id) => {
        const tenant = tenants.get(id);
        if (!tenant) throw new Error(`unknown tenant ${id}`);
        return tenant;
      },
    });

    const endpoint = new URL("http://in-memory-mcp.test/mcp");

    async function connectTenant(tenantId: string): Promise<Client> {
      const transport = new StreamableHTTPClientTransport(endpoint, {
        fetch: tenantFetch,
        requestInit: {
          headers: {
            "x-tenant-id": tenantId,
          },
        },
      });
      const client = new Client(
        { name: `${tenantId}-client`, version: "1.0.0" },
        { capabilities: {} },
      );
      await client.connect(transport);
      return client;
    }

    return { tenants, connectTenant };
  }

  function firstTextBlock(result: Awaited<ReturnType<Client["callTool"]>>): string {
    const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
    return content.find((block) => block.type === "text")?.text ?? "";
  }

  it("routes each request to its own cli clone with tenant-specific cwd/env/fs", async () => {
    const { tenants, connectTenant } = setupScenario();

    const aliceClient = await connectTenant("tenant-a");
    const bobClient = await connectTenant("tenant-b");

    try {
      const aliceTools = (await aliceClient.listTools()).tools.map((t) => t.name).sort();
      const bobTools = (await bobClient.listTools()).tools.map((t) => t.name).sort();
      expect(aliceTools).toEqual(["load", "save"]);
      expect(bobTools).toEqual(["load", "save"]);

      const aliceSave = await aliceClient.callTool({
        name: "save",
        arguments: { filename: "notes.txt", content: "alice-secret" },
      });
      const bobSave = await bobClient.callTool({
        name: "save",
        arguments: { filename: "notes.txt", content: "bob-secret" },
      });

      expect(firstTextBlock(aliceSave)).toContain("/workspace-a/notes.txt");
      expect(firstTextBlock(aliceSave)).toContain("tenant-a");
      expect(firstTextBlock(bobSave)).toContain("/workspace-b/notes.txt");
      expect(firstTextBlock(bobSave)).toContain("tenant-b");

      const aliceLoad = await aliceClient.callTool({
        name: "load",
        arguments: { filename: "notes.txt" },
      });
      const bobLoad = await bobClient.callTool({
        name: "load",
        arguments: { filename: "notes.txt" },
      });

      expect(firstTextBlock(aliceLoad)).toContain("alice-secret");
      expect(firstTextBlock(aliceLoad)).not.toContain("bob-secret");
      expect(firstTextBlock(bobLoad)).toContain("bob-secret");
      expect(firstTextBlock(bobLoad)).not.toContain("alice-secret");

      const tenantAFs = tenants.get("tenant-a")!.fs;
      const tenantBFs = tenants.get("tenant-b")!.fs;
      expect([...tenantAFs.files.keys()]).toEqual(["/workspace-a/notes.txt"]);
      expect([...tenantBFs.files.keys()]).toEqual(["/workspace-b/notes.txt"]);
      expect(tenantAFs.files.get("/workspace-a/notes.txt")).toBe("alice-secret");
      expect(tenantBFs.files.get("/workspace-b/notes.txt")).toBe("bob-secret");
    } finally {
      await aliceClient.close();
      await bobClient.close();
    }
  });

  it("raises a tool error when a tenant reads a file it never wrote", async () => {
    const { connectTenant } = setupScenario();

    const bobClient = await connectTenant("tenant-b");
    try {
      const result = await bobClient.callTool({
        name: "load",
        arguments: { filename: "does-not-exist.txt" },
      });
      expect(result.isError).toBe(true);
      expect(firstTextBlock(result)).toMatch(/ENOENT/);
    } finally {
      await bobClient.close();
    }
  });
});
