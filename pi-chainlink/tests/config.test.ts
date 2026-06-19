/**
 * Config tests — verify hook-config.json loading.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "chainlink-config-test-"));
    mkdirSync(join(testDir, ".chainlink"), { recursive: true });
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns defaults when no config file exists", () => {
    const config = loadConfig(testDir);
    expect(config.tracking_mode).toBe("strict");
    expect(config.blocked_git_commands).toContain("git push");
    expect(config.allowed_bash_prefixes).toContain("chainlink ");
  });

  it("parses valid JSON config", () => {
    writeFileSync(
      join(testDir, ".chainlink", "hook-config.json"),
      JSON.stringify({
        tracking_mode: "relaxed",
        blocked_git_commands: ["git push", "git commit"],
        allowed_bash_prefixes: ["chainlink ", "git status"],
      }),
    );

    const config = loadConfig(testDir);
    expect(config.tracking_mode).toBe("relaxed");
    expect(config.blocked_git_commands).toEqual(["git push", "git commit"]);
    expect(config.allowed_bash_prefixes).toEqual(["chainlink ", "git status"]);
  });

  it("handles malformed JSON gracefully (falls back to defaults)", () => {
    writeFileSync(join(testDir, ".chainlink", "hook-config.json"), "not valid {{ json");

    const config = loadConfig(testDir);
    expect(config.tracking_mode).toBe("strict"); // Default
  });

  it("returns correct tracking mode values", () => {
    writeFileSync(
      join(testDir, ".chainlink", "hook-config.json"),
      JSON.stringify({ tracking_mode: "normal" }),
    );

    const config = loadConfig(testDir);
    expect(config.tracking_mode).toBe("normal");
  });

  it("validates tracking mode (invalid values fall back to strict)", () => {
    writeFileSync(
      join(testDir, ".chainlink", "hook-config.json"),
      JSON.stringify({ tracking_mode: "invalid_mode" }),
    );

    const config = loadConfig(testDir);
    expect(config.tracking_mode).toBe("strict");
  });
});
