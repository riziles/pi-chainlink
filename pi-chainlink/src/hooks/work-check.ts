/**
 * Work-check hook — enforces chainlink issue tracking before write/edit/bash.
 * Mirrors chainlink's work-check.py but in-process via pi events.
 */

import { normalize, relative, sep } from "node:path";
import type { ChainlinkClient } from "../client.js";
import type { ChainlinkConfig } from "../config.js";

// ── Tool file path parameter mapping ────────────────────────────────────

/**
 * Maps pi tool names to their file path parameter names.
 * write uses `path`, edit uses `path`.
 */
const TOOL_FILE_PATH_PARAMS: Record<string, string[]> = {
  write: ["path"],
  edit: ["path"],
};

/**
 * Extract the file path from a tool call's input parameters.
 */
export function getFilePathFromTool(
  toolName: string,
  input: Record<string, unknown>,
): string | null {
  const candidates = TOOL_FILE_PATH_PARAMS[toolName];
  if (!candidates) return null;

  for (const key of candidates) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return null;
}

// ── Protected path detection ────────────────────────────────────────────

/**
 * Check if a file path targets chainlink hook infrastructure.
 * Protected: .chainlink/hook-config.json, .chainlink/rules/
 */
export function isProtectedPath(filePath: string, chainlinkDir: string): boolean {
  const normalized = normalize(filePath);
  const chainlinkConfigDir = normalize(`${chainlinkDir}${sep}.chainlink`);

  // .chainlink/hook-config.json
  if (normalized === normalize(`${chainlinkDir}${sep}.chainlink${sep}hook-config.json`)) {
    return true;
  }

  // .chainlink/rules/ directory
  if (normalized.startsWith(normalize(`${chainlinkDir}${sep}.chainlink${sep}rules${sep}`))) {
    return true;
  }

  return false;
}

// ── Blocked git command detection ───────────────────────────────────────

/**
 * Normalize a git command by stripping global flags (-C, --git-dir, -c).
 */
function normalizeGitCommand(command: string): string {
  // Remove leading whitespace
  let cmd = command.trim();

  // Strip git global flags: -C <path>, --git-dir=<path>, -c <key>=<value>
  cmd = cmd.replace(/(-C\s+\S+)/g, "");
  cmd = cmd.replace(/(--git-dir=\S+)/g, "");
  cmd = cmd.replace(/(-c\s+\S+)/g, "");

  // Collapse whitespace
  cmd = cmd.replace(/\s+/g, " ").trim();

  return cmd;
}

/**
 * Check if a bash command is a blocked git mutation command.
 */
export function isBlockedGit(command: string, blockedList: string[]): boolean {
  const normalized = normalizeGitCommand(command);

  if (!normalized.startsWith("git ")) return false;

  for (const blocked of blockedList) {
    if (normalized.startsWith(blocked)) {
      return true;
    }
  }

  return false;
}

// ── Allowed bash detection ──────────────────────────────────────────────

/**
 * Commands blocked in strict mode to prevent shell bypasses.
 * Prevents: eval, bash -c, sh -c, source, ., exec
 */
const BLOCKED_SHELL_BUILTINS = ["eval ", "bash -c ", "sh -c ", "source ", ". ", "exec "];

/**
 * Check if a bash command is in the allowed list.
 * In strict mode, also blocks shell bypass builtins.
 * Every subcommand in a chain (;, &&, ||, |) must be allowed.
 */
export function isAllowedBash(
  command: string,
  allowedList: string[],
  mode: "strict" | "normal" | "relaxed",
): boolean {
  const trimmed = command.trim();

  // Block shell bypass builtins in strict and normal mode
  if (mode !== "relaxed") {
    for (const builtin of BLOCKED_SHELL_BUILTINS) {
      if (trimmed.startsWith(builtin) || trimmed.includes(` ${builtin}`)) {
        return false;
      }
    }
  }

  // Split on command separators
  const subcommands = trimmed.split(/\s*(?:&&|;|\|\|?)\s*/);

  for (const sub of subcommands) {
    const normalized = sub.trim();
    if (normalized.length === 0) continue;

    const isAllowed = allowedList.some((prefix) => normalized.startsWith(prefix));
    if (!isAllowed) return false;
  }

  return true;
}

// ── Work-check result ───────────────────────────────────────────────────

export interface WorkCheckResult {
  block: boolean;
  reason?: string;
}

/**
 * Run the full work-check guard chain for a tool call.
 * Returns { block: true, reason } if the tool should be blocked,
 * or { block: false } if it should proceed.
 */
export async function runWorkCheck(
  toolName: string,
  input: Record<string, unknown>,
  chainlinkDir: string,
  config: ChainlinkConfig,
  client: ChainlinkClient,
  ourAgentId: string,
): Promise<WorkCheckResult> {
  // Guard 1: Protect hook infrastructure
  if (toolName === "write" || toolName === "edit") {
    const filePath = getFilePathFromTool(toolName, input);
    if (filePath && isProtectedPath(filePath, chainlinkDir)) {
      return {
        block: true,
        reason:
          "Modifying chainlink hook infrastructure (.chainlink/hook-config.json, " +
          ".chainlink/rules/) is permanently forbidden. " +
          "These files control project safety constraints.",
      };
    }
  }

  // Guard 2: Blocked git commands (permanent block, all modes)
  if (toolName === "bash" && typeof input.command === "string") {
    if (isBlockedGit(input.command, config.blocked_git_commands)) {
      return {
        block: true,
        reason:
          "Git mutation commands (push, commit, merge, rebase, reset, etc.) are " +
          "PERMANENTLY FORBIDDEN. The human performs all git write operations.\n\n" +
          "Read-only git commands (status, diff, log, show, branch) are allowed.",
      };
    }
  }

  // Guard 3: Allow-listed bash (always pass)
  if (toolName === "bash" && typeof input.command === "string") {
    if (isAllowedBash(input.command, config.allowed_bash_prefixes, config.tracking_mode)) {
      return { block: false };
    }
  }

  // Guard 4: Relaxed mode — skip issue enforcement
  if (config.tracking_mode === "relaxed") return { block: false };

  // Guard 5: Check for active issue
  const status = await client.sessionStatus();
  if (!status || !status.activeIssue) {
    const msg =
      config.tracking_mode === "strict"
        ? "MANDATORY: You must have an active chainlink issue before writing, editing, " +
          "or running bash commands.\n\n" +
          'Create one: chainlink issue quick "<describe the work>" -p <priority> -l <label>\n' +
          "Or pick existing: chainlink issue list -s open && chainlink session work <id>"
        : "Reminder: No active chainlink issue. Consider creating one before making changes.";

    if (config.tracking_mode === "strict") {
      return { block: true, reason: msg };
    }
    return { block: false }; // normal mode — allow but warn (warning handled by extension)
  }

  // Guard 6: Lock conflict check
  if (status.activeIssue) {
    const lockResult = await client.locksCheck(status.activeIssue.id);
    if (lockResult && lockResult.includes("locked by") && !lockResult.includes(ourAgentId)) {
      const msg =
        `Lock conflict: Issue #${status.activeIssue.id} is ${lockResult}. ` +
        "Another agent has claimed this issue.";
      if (config.tracking_mode === "strict") {
        return { block: true, reason: msg };
      }
      // Normal mode — allow but warn
    }
  }

  return { block: false };
}
