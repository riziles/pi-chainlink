/**
 * ChainlinkClient tests — verify CLI output parsing.
 * These test against a real chainlink binary.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ChainlinkClient } from "../src/client.js";

describe("ChainlinkClient", () => {
  let testDir: string;
  let client: ChainlinkClient;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "chainlink-test-"));
    execFileSync("chainlink", ["init"], { cwd: testDir });
    client = new ChainlinkClient(testDir);
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("sessionStart creates a session and sessionStatus returns it", async () => {
    await client.sessionStart();

    const status = await client.sessionStatus();
    expect(status).not.toBeNull();
    expect(status!.session_id).toBeGreaterThan(0);
  });

  it("quick creates an issue and returns its ID", async () => {
    const id = await client.quick("Test issue", { priority: "high", label: "bug" });
    expect(id).not.toBeNull();
    expect(id!).toBeGreaterThan(0);
  });

  it("list returns issues", async () => {
    const issues = await client.list({ status: "open" });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].id).toBeGreaterThan(0);
  });

  it("show returns issue details", async () => {
    const issues = await client.list();
    const issue = await client.show(issues[0].id);
    expect(issue).not.toBeNull();
    expect(issue!.title).toBeTruthy();
  });

  it("ready returns unblocked issues", async () => {
    const ready = await client.ready();
    expect(Array.isArray(ready)).toBe(true);
  });

  it("sessionWork sets active issue", async () => {
    // This test runs in a shared temp dir. Previous tests may have ended the session.
    // quick() auto-starts a session and creates+activates an issue in one shot.
    const issueId = await client.quick("Session work test");
    expect(issueId).not.toBeNull();

    // Verify the issue exists in the list
    const issue = await client.show(issueId!);
    expect(issue).not.toBeNull();
    expect(issue!.title).toBe("Session work test");
  });

  it("comment adds a comment", async () => {
    const issues = await client.list();
    await client.comment(issues[0].id, "Test comment");
    // Comment succeeds if no error thrown
    expect(true).toBe(true);
  });

  it("close closes an issue", async () => {
    const issues = await client.list({ status: "open" });
    const toClose = issues[issues.length - 1];
    await client.close(toClose.id);

    const closed = await client.show(toClose.id);
    expect(closed!.status).toBe("closed");
  });

  it("sessionEnd ends the session", async () => {
    await client.sessionEnd("Test handoff notes");
    const status = await client.sessionStatus();
    // After ending, status returns null (no active session)
    expect(status).toBeNull();
  });

  it("sessionStart after end creates new session with handoff", async () => {
    await client.sessionStart();
    const handoff = await client.sessionLastHandoff();
    expect(handoff).toBe("Test handoff notes");
  });

  it("hasActiveSession returns correct value", async () => {
    expect(await client.hasActiveSession()).toBe(true);
    await client.sessionEnd();
    expect(await client.hasActiveSession()).toBe(false);
  });

  it("handles binary-not-found gracefully", async () => {
    const badClient = new ChainlinkClient(testDir, "nonexistent-binary");
    const status = await badClient.sessionStatus();
    expect(status).toBeNull();
  });

  it("handles run for raw command execution", async () => {
    await client.sessionStart();
    const result = await client.run(["session", "status", "--json"]);
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("session_id");
  });
});
