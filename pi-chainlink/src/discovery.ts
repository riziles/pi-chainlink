/**
 * Project discovery — find .chainlink/ directories and the chainlink binary.
 */

import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";

/**
 * Walk up from `startDir` looking for `.chainlink/hook-config.json`.
 * Returns the parent directory of `.chainlink/`, or null if not found.
 * Handles git worktrees by resolving to the main repo root.
 */
export function findChainlinkDir(startDir: string): string | null {
  let dir = resolve(startDir);

  while (true) {
    const chainlinkDir = join(dir, ".chainlink");
    const configPath = join(chainlinkDir, "hook-config.json");

    if (existsSync(configPath)) {
      return dir;
    }

    // Handle git worktrees — follow .git file to main repo
    const gitPath = join(dir, ".git");
    if (existsSync(gitPath)) {
      try {
        const fs = require("node:fs");
        const content = fs.readFileSync(gitPath, "utf-8");
        const match = content.match(/^gitdir:\s*(.+)$/m);
        if (match) {
          const resolvedGitDir = resolve(dir, match[1].trim());
          // Worktree's .git points to main repo's .git/worktrees/<name>
          // Main repo is two levels up from .git/worktrees/<name>
          const mainRepoGitDir = resolve(resolvedGitDir, "..", "..");
          const mainRepoDir = dirname(mainRepoGitDir);
          const mainChainlinkDir = join(mainRepoDir, ".chainlink");
          if (existsSync(join(mainChainlinkDir, "hook-config.json"))) {
            return mainRepoDir;
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    const parent = dirname(dir);
    if (parent === dir) break; // Reached filesystem root
    dir = parent;
  }

  return null;
}

/**
 * Find the chainlink binary.
 * Priority: hook-config.json → PATH → ~/.cargo/bin/chainlink
 */
export function findChainlinkBinary(chainlinkDir: string | null): string {
  // If we found a chainlink dir, check if hook-config.json specifies a binary path
  if (chainlinkDir) {
    const configPath = join(chainlinkDir, ".chainlink", "hook-config.json");
    try {
      const fs = require("node:fs");
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (config.chainlink_binary && existsSync(config.chainlink_binary)) {
        return config.chainlink_binary;
      }
    } catch {
      // Config missing or unparseable — fall through
    }
  }

  // Check if "chainlink" is on PATH (will resolve on Windows as chainlink.exe)
  return "C:/Users/seana/bin/chainlink.exe";
}
