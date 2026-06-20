/**
 * pi-chainlink extension — integrates Chainlink issue tracking with pi.
 *
 * Subscribes to pi lifecycle events to inject context, enforce workflows,
 * detect stubs, and remind about chainlink usage.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { ChainlinkClient } from "./client.js";
import { findChainlinkDir, findChainlinkBinary } from "./discovery.js";
import { loadConfig } from "./config.js";
import { buildContext } from "./context.js";
import { handleSessionLifecycle } from "./hooks/session.js";
import { runWorkCheck } from "./hooks/work-check.js";
import { checkFileForStubs, buildStubMessage } from "./hooks/post-edit.js";
import { resetPromptCounter, checkPromptGuard } from "./hooks/prompt-guard.js";
import { registerTools } from "./tools.js";

// ── Agent identity ──────────────────────────────────────────────────────

/**
 * Generate or load a stable agent identity for this pi instance.
 * Used for lock ownership tracking.
 */
function getAgentId(): string {
  // Use a random UUID per process — similar to chainlink's agent init
  return randomUUID();
}

// ── Context cache ───────────────────────────────────────────────────────

let storedContext: string | null = null;
let lastContextTime = 0;
const CONTEXT_STALENESS_MS = 5 * 60 * 1000; // 5 minutes

// ── Extension ───────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const agentId = getAgentId();
  registerTools(pi);

  // ── session_start: load chainlink config and inject context ────────

  pi.on("session_start", async (_event, ctx) => {
    const chainlinkDir = findChainlinkDir(ctx.cwd);
    if (!chainlinkDir) return;

    const binaryPath = findChainlinkBinary(chainlinkDir);
    const client = new ChainlinkClient(chainlinkDir, binaryPath);
    const config = loadConfig(chainlinkDir);

    // Auto-handle session lifecycle
    await handleSessionLifecycle(client);

    // Build and cache context
    try {
      storedContext = await buildContext(chainlinkDir, client, config);
      lastContextTime = Date.now();
    } catch {
      storedContext = null;
    }
  });

  // ── before_agent_start: inject context (with freshness check) ─────

  pi.on("before_agent_start", async (_event, ctx) => {
    // Prompt guard
    const reminder = checkPromptGuard();
    if (reminder) {
      ctx.ui.notify(reminder, "info");
    }

    // Context injection
    if (!storedContext) return;

    const chainlinkDir = findChainlinkDir(ctx.cwd);
    if (!chainlinkDir) {
      storedContext = null;
      return;
    }

    // Re-generate if stale (handles compaction, long sessions)
    if (Date.now() - lastContextTime > CONTEXT_STALENESS_MS) {
      try {
        const binaryPath = findChainlinkBinary(chainlinkDir);
        const client = new ChainlinkClient(chainlinkDir, binaryPath);
        const config = loadConfig(chainlinkDir);
        storedContext = await buildContext(chainlinkDir, client, config);
        lastContextTime = Date.now();
      } catch {
        // Keep old context on failure
      }
    }

    return {
      message: {
        customType: "chainlink-context",
        content: storedContext,
        display: false, // Don't show in TUI (mostly internal)
      },
    };
  });

  // ── session_compact: force context re-generation ──────────────────

  pi.on("session_compact", async (_event, ctx) => {
    // Mark context as stale so it re-generates on next before_agent_start
    lastContextTime = 0;

    const chainlinkDir = findChainlinkDir(ctx.cwd);
    if (chainlinkDir) {
      try {
        const binaryPath = findChainlinkBinary(chainlinkDir);
        const client = new ChainlinkClient(chainlinkDir, binaryPath);
        const config = loadConfig(chainlinkDir);
        storedContext = await buildContext(chainlinkDir, client, config);
        lastContextTime = Date.now();
      } catch {
        storedContext = null;
      }
    }
  });

  // ── tool_call: work-check enforcement ─────────────────────────────

  pi.on("tool_call", async (event, ctx) => {
    // Only intercept write, edit, bash
    if (!["write", "edit", "bash"].includes(event.toolName)) return;

    // Reset prompt guard if agent called a chainlink command
    if (event.toolName === "bash") {
      const command = (event.input as any)?.command;
      if (typeof command === "string" && command.startsWith("chainlink ")) {
        resetPromptCounter();
      }
    }

    const chainlinkDir = findChainlinkDir(ctx.cwd);
    if (!chainlinkDir) return; // Not a chainlink project — allow

    const binaryPath = findChainlinkBinary(chainlinkDir);
    const client = new ChainlinkClient(chainlinkDir, binaryPath);
    const config = loadConfig(chainlinkDir);

    const result = await runWorkCheck(
      event.toolName,
      event.input as Record<string, unknown>,
      chainlinkDir,
      config,
      client,
      agentId,
    );

    if (result.block) {
      return { block: true, reason: result.reason };
    }

    // Normal mode warnings (issue-less work)
    if (config.tracking_mode === "normal") {
      const status = await client.sessionStatus();
      if (!status || !status.active_issue) {
        ctx.ui.notify(
          "Reminder: No active chainlink issue. Consider creating one before making changes.",
          "warn",
        );
      }
    }
  });

  // ── tool_result: stub detection ───────────────────────────────────

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return;

    const chainlinkDir = findChainlinkDir(ctx.cwd);
    if (!chainlinkDir) return;

    const input = event.input as Record<string, unknown>;
    const filePath = input.path as string | undefined;
    if (!filePath) return;

    const stubs = await checkFileForStubs(filePath);
    if (stubs.length > 0) {
      ctx.ui.notify(buildStubMessage(filePath, stubs), "warn");
    }
  });
}
