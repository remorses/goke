#!/usr/bin/env node
/**
 * Notion MCP CLI with OAuth support.
 *
 * Usage:
 *   notion-mcp-cli login          # Authenticate (runs in background for agents)
 *   notion-mcp-cli me             # Check auth status (exits 1 if not logged in)
 *   notion-mcp-cli notion-search  # Search Notion
 *   notion-mcp-cli notion-fetch   # Fetch a page
 *   notion-mcp-cli status         # Show current config
 *   notion-mcp-cli logout         # Clear OAuth tokens
 */

import { goke, isAgent } from "goke";
import { z } from "zod";
import { addMcpCommands, startOAuthFlow } from "@goke/mcp";
import type { McpOAuthState, CachedMcpTools } from "@goke/mcp";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CONFIG_DIR = path.join(os.homedir(), ".notion-mcp-cli");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

interface NotionCliConfig {
  mcpUrl: string;
  oauthState?: McpOAuthState;
  cache?: CachedMcpTools;
}

function loadConfig(): NotionCliConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    return { mcpUrl: "https://mcp.notion.com/mcp" };
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return { mcpUrl: "https://mcp.notion.com/mcp" };
  }
}

function saveConfig(config: Partial<NotionCliConfig>): void {
  const existing = loadConfig();
  const merged = { ...existing, ...config };
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
}

const cli = goke("notion-mcp-cli");

// Add MCP commands with OAuth support (no prefix - commands are top-level)
await addMcpCommands({
  cli,
  clientName: "notion-mcp-cli",
  getMcpUrl: () => loadConfig().mcpUrl,
  oauth: {
    clientName: "Notion CLI",
    load: () => loadConfig().oauthState,
    save: (state) => {
      saveConfig({ oauthState: state });
    },
  },
  loadCache: () => loadConfig().cache,
  saveCache: (cache) => {
    saveConfig({ cache });
  },
});

// Login command — runs OAuth flow, background daemon for agents
cli
  .command("login", "Authenticate with Notion via OAuth")
  .option("--url <url>", z.string().default("https://mcp.notion.com/mcp").describe("MCP server URL"))
  .action(async (options, ctx) => {
    saveConfig({ mcpUrl: options.url });

    if (ctx.daemon.isDaemon) {
      // ── DAEMON: run OAuth flow in background ──
      // startOAuthFlow() blocks until the user approves in the browser (the
      // internal callback server keeps the event loop alive). When it returns,
      // tokens are saved to disk and the daemon exits naturally.
      const result = await startOAuthFlow({
        serverUrl: options.url,
        clientName: "Notion CLI",
        existingState: loadConfig().oauthState,
        timeout: 10 * 60 * 1000,
      });

      if (result.success && result.state) {
        saveConfig({ oauthState: result.state });
      }
      return;
    }

    // ── CLIENT: decide foreground vs background ──
    if (isAgent) {
      // Agent mode: start daemon and return immediately
      await ctx.daemon.start({ timeoutMs: 10 * 60 * 1000 });
      ctx.console.log("Login server running in background (10 min timeout).");
      ctx.console.log("The user needs to complete authentication in their browser.");
      ctx.console.log("");
      ctx.console.log("To check if login succeeded:");
      ctx.console.log("  notion-mcp-cli me");
      return;
    }

    // Interactive mode: run OAuth flow directly (blocks until done)
    ctx.console.log("Opening browser for authentication...\n");
    const result = await startOAuthFlow({
      serverUrl: options.url,
      clientName: "Notion CLI",
      existingState: loadConfig().oauthState,
    });

    if (result.success && result.state) {
      saveConfig({ oauthState: result.state });
      ctx.console.log("Login successful!");
    } else {
      ctx.console.error(`Login failed: ${result.error || "unknown error"}`);
      ctx.process.exit(1);
    }
  });

// Me command — agent-friendly auth check (exits 1 if not logged in)
cli
  .command("me", "Check authentication status (exits 1 if not logged in)")
  .action(async (options, ctx) => {
    const config = loadConfig();
    if (config.oauthState?.tokens) {
      ctx.console.log("Authenticated");
      ctx.console.log(`MCP URL: ${config.mcpUrl}`);
      return;
    }

    // Check if login daemon is still running (user might not have approved yet)
    const loginDaemon = ctx.daemon.forCommand("login");
    if (await loginDaemon.isRunning()) {
      ctx.console.error("Login in progress. Approve in browser first.");
      ctx.process.exit(1);
    }

    ctx.console.error("Not logged in. Run `notion-mcp-cli login` first.");
    ctx.process.exit(1);
  });

// Logout command
cli.command("logout", "Clear OAuth tokens and cache").action(async (options, ctx) => {
  // Stop any running login daemon
  const loginDaemon = ctx.daemon.forCommand("login");
  await loginDaemon.stop();
  saveConfig({ oauthState: undefined, cache: undefined });
  ctx.console.log("Cleared OAuth state and cache");
});

// Status command
cli.command("status", "Show current config").action((options, ctx) => {
  const config = loadConfig();
  const hasTokens = !!config.oauthState?.tokens;
  const toolCount = config.cache?.tools?.length || 0;

  ctx.console.log("Notion CLI Status");
  ctx.console.log("─".repeat(40));
  ctx.console.log(`MCP URL:     ${config.mcpUrl}`);
  ctx.console.log(`Logged in:   ${hasTokens ? "Yes" : "No"}`);
  ctx.console.log(`Tools cached: ${toolCount}`);
  ctx.console.log(`Config file: ${CONFIG_FILE}`);
});

cli.help();
cli.version("0.0.5");
cli.parse();
