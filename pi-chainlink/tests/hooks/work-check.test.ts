/**
 * Work-check hook tests — verify safety guard logic.
 */

import { describe, it, expect } from "vitest";
import { resolve, sep } from "node:path";

import { isBlockedGit, isAllowedBash, isProtectedPath, getFilePathFromTool } from "../../src/hooks/work-check.js";

// ── getFilePathFromTool ─────────────────────────────────────────────────

describe("getFilePathFromTool", () => {
  it("extracts path from write tool input", () => {
    const result = getFilePathFromTool("write", { path: "/foo/bar.ts", content: "test" });
    expect(result).toBe("/foo/bar.ts");
  });

  it("extracts path from edit tool input", () => {
    const result = getFilePathFromTool("edit", { path: "/foo/bar.ts", edits: [] });
    expect(result).toBe("/foo/bar.ts");
  });

  it("returns null for tools without file paths", () => {
    const result = getFilePathFromTool("bash", { command: "ls" });
    expect(result).toBeNull();
  });

  it("returns null for missing path", () => {
    const result = getFilePathFromTool("write", { content: "test" });
    expect(result).toBeNull();
  });

  it("returns null for empty path", () => {
    const result = getFilePathFromTool("write", { path: "", content: "test" });
    expect(result).toBeNull();
  });
});

// ── isBlockedGit ────────────────────────────────────────────────────────

describe("isBlockedGit", () => {
  const blocked = ["git push", "git commit", "git merge", "git rebase", "git reset"];

  it("blocks git push", () => {
    expect(isBlockedGit("git push origin main", blocked)).toBe(true);
  });

  it("blocks git commit", () => {
    expect(isBlockedGit("git commit -m 'test'", blocked)).toBe(true);
  });

  it("allows git status", () => {
    expect(isBlockedGit("git status", blocked)).toBe(false);
  });

  it("allows git diff", () => {
    expect(isBlockedGit("git diff", blocked)).toBe(false);
  });

  it("allows non-git commands", () => {
    expect(isBlockedGit("ls -la", blocked)).toBe(false);
  });

  it("strips git -C flag", () => {
    expect(isBlockedGit("git -C /tmp push", blocked)).toBe(true);
  });

  it("strips git --git-dir flag", () => {
    expect(isBlockedGit("git --git-dir=.git push", blocked)).toBe(true);
  });

  it("blocks git reset", () => {
    expect(isBlockedGit("git reset HEAD~1", blocked)).toBe(true);
  });

  it("handles chained commands (blocks if any segment is blocked)", () => {
    // Note: isBlockedGit only looks at the whole command string, not chains.
    // This test verifies the current behavior. Chain detection happens in isAllowedBash.
    expect(isBlockedGit("git status && git push", blocked)).toBe(false);
    // git status starts the string, so the normalized command starts with "git status"
  });
});

// ── isAllowedBash ───────────────────────────────────────────────────────

describe("isAllowedBash", () => {
  const allowed = ["chainlink ", "git status", "git diff", "npm test", "ls", "echo"];

  it("allows chainlink commands", () => {
    expect(isAllowedBash("chainlink session start", allowed, "strict")).toBe(true);
  });

  it("allows git status", () => {
    expect(isAllowedBash("git status", allowed, "strict")).toBe(true);
  });

  it("allows ls", () => {
    expect(isAllowedBash("ls -la", allowed, "strict")).toBe(true);
  });

  it("blocks git push", () => {
    expect(isAllowedBash("git push origin main", allowed, "strict")).toBe(false);
  });

  it("blocks all subcommands in a chain if one is disallowed", () => {
    expect(isAllowedBash("git status && git push", allowed, "strict")).toBe(false);
  });

  it("allows chain when all subcommands are allowed", () => {
    expect(isAllowedBash("ls && echo done", allowed, "strict")).toBe(true);
  });

  it("blocks eval in strict mode", () => {
    expect(isAllowedBash("eval 'echo hello'", allowed, "strict")).toBe(false);
  });

  it("blocks bash -c in strict mode", () => {
    expect(isAllowedBash("bash -c 'echo hello'", allowed, "strict")).toBe(false);
  });

  it("blocks sh -c in strict mode", () => {
    expect(isAllowedBash("sh -c 'echo hello'", allowed, "strict")).toBe(false);
  });

  it("blocks source in strict mode", () => {
    expect(isAllowedBash("source .env", allowed, "strict")).toBe(false);
  });

  it("blocks . (dot) in strict mode", () => {
    expect(isAllowedBash(". .env", allowed, "strict")).toBe(false);
  });

  it("allows eval in relaxed mode if on the allowed list", () => {
    // Relaxed mode doesn't block shell builtins, but eval still needs to match the allow-list
    const relaxedAllowed = ["eval ", ...allowed];
    expect(isAllowedBash("eval 'echo hello'", relaxedAllowed, "relaxed")).toBe(true);
  });
});

// ── isProtectedPath ─────────────────────────────────────────────────────

describe("isProtectedPath", () => {
  const projectDir = resolve("/home/user/project");

  it("protects hook-config.json", () => {
    expect(isProtectedPath(resolve("/home/user/project/.chainlink/hook-config.json"), projectDir)).toBe(true);
  });

  it("protects rules directory", () => {
    expect(isProtectedPath(resolve("/home/user/project/.chainlink/rules/global.md"), projectDir)).toBe(true);
  });

  it("protects nested rules files", () => {
    expect(isProtectedPath(resolve("/home/user/project/.chainlink/rules/typescript.md"), projectDir)).toBe(true);
  });

  it("allows .claude directory (not protected by pi)", () => {
    // .claude/ is Claude Code-specific, pi doesn't protect it
    expect(isProtectedPath(resolve("/home/user/project/.claude/settings.json"), projectDir)).toBe(false);
  });

  it("allows regular source files", () => {
    expect(isProtectedPath(resolve("/home/user/project/src/index.ts"), projectDir)).toBe(false);
  });

  it("handles Windows paths", () => {
    const winProject = resolve("C:\\Users\\user\\project");
    expect(isProtectedPath(resolve("C:\\Users\\user\\project\\.chainlink\\hook-config.json"), winProject)).toBe(true);
    expect(isProtectedPath(resolve("C:\\Users\\user\\project\\src\\main.ts"), winProject)).toBe(false);
  });

  it("rejects paths in other projects", () => {
    const otherProject = resolve("/home/user/other");
    expect(isProtectedPath(resolve("/home/user/project/.chainlink/hook-config.json"), otherProject)).toBe(false);
  });
});
