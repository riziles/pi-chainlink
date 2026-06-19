/**
 * Configuration reader — loads chainlink hook-config.json.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface ChainlinkConfig {
  tracking_mode: "strict" | "normal" | "relaxed";
  blocked_git_commands: string[];
  allowed_bash_prefixes: string[];
}

const DEFAULT_CONFIG: ChainlinkConfig = {
  tracking_mode: "strict",
  blocked_git_commands: [
    "git push", "git commit", "git merge", "git rebase", "git cherry-pick",
    "git reset", "git checkout .", "git restore .", "git clean",
    "git stash", "git tag", "git am", "git apply",
    "git branch -d", "git branch -D", "git branch -m",
  ],
  allowed_bash_prefixes: [
    "cd ", "chainlink ",
    "git status", "git diff", "git log", "git branch", "git show",
    "cargo test", "cargo build", "cargo check", "cargo clippy", "cargo fmt",
    "npm test", "npm run", "npx ",
    "tsc", "node ", "python ",
    "ls", "dir", "pwd", "echo",
  ],
};

/**
 * Load chainlink configuration from .chainlink/hook-config.json.
 * Falls back to hardcoded defaults if file missing or unparseable.
 */
export function loadConfig(chainlinkDir: string): ChainlinkConfig {
  const configPath = join(chainlinkDir, ".chainlink", "hook-config.json");

  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);

    return {
      tracking_mode: validateTrackingMode(parsed.tracking_mode),
      blocked_git_commands: Array.isArray(parsed.blocked_git_commands)
        ? parsed.blocked_git_commands
        : [...DEFAULT_CONFIG.blocked_git_commands],
      allowed_bash_prefixes: Array.isArray(parsed.allowed_bash_prefixes)
        ? parsed.allowed_bash_prefixes
        : [...DEFAULT_CONFIG.allowed_bash_prefixes],
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function validateTrackingMode(mode: unknown): "strict" | "normal" | "relaxed" {
  if (mode === "strict" || mode === "normal" || mode === "relaxed") {
    return mode;
  }
  return "strict";
}
