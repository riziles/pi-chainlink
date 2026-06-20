/**
 * ChainlinkClient — Promise-based TypeScript wrapper around the chainlink binary.
 *
 * All methods are async. No sync I/O — avoids blocking pi's event loop.
 * Internal mutex serializes CLI operations to prevent SQLite lock contention.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────────────────────

export interface SessionStatus {
  session_id: number;
  started_at: string;
  duration_minutes: number;
  active_issue: { id: number; title: string } | null;
  last_action: string | null;
}

export interface Issue {
  id: number;
  title: string;
  description: string | null;
  status: "open" | "closed";
  priority: "low" | "medium" | "high" | "critical";
  parent_id: number | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface ListOpts {
  status?: "open" | "closed" | "all";
  priority?: string;
  label?: string;
}

export interface CloseOpts {
  comment?: string;
}

// ── ChainlinkClient ──────────────────────────────────────────────────────

export class ChainlinkClient {
  private chainlinkDir: string;
  private binaryPath: string;
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * @param chainlinkDir - Path to the directory containing .chainlink/
   * @param binaryPath - Path to the chainlink executable (default: "chainlink" from PATH)
   */
  constructor(chainlinkDir: string, binaryPath = "chainlink") {
    this.chainlinkDir = chainlinkDir;
    this.binaryPath = binaryPath;
  }

  // ── Serialization mutex ──────────────────────────────────────────────

  /** Serialize all CLI operations to prevent SQLite lock contention. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn, fn);
    this.queue = result.catch(() => {});
    return result;
  }

  // ── Raw execution ────────────────────────────────────────────────────

  /**
   * Run a chainlink command and return JSON-parsed stdout.
   * Handles binary-not-found gracefully (returns null).
   */
  private async runJson<T>(args: string[], timeoutMs = 5000): Promise<T | null> {
    return this.enqueue(async () => {
      try {
        const { stdout } = await execFileAsync(this.binaryPath, args, {
          cwd: this.chainlinkDir,
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024, // 1MB
          windowsHide: true,
        });
        if (!stdout.trim()) return null;
        return JSON.parse(stdout.trim()) as T;
      } catch (err) {
        const code = (err as any)?.code;
        // Binary not found
        if (code === "ENOENT") return null;
        // Timeout
        if ((err as any)?.killed) return null;
        // Non-zero exit (e.g., no active session, no issues)
        return null;
      }
    });
  }

  /**
   * Run a chainlink command and return raw stdout.
   * Handles binary-not-found gracefully (returns null).
   */
  private async runRaw(args: string[], timeoutMs = 5000): Promise<string | null> {
    return this.enqueue(async () => {
      try {
        const { stdout } = await execFileAsync(this.binaryPath, args, {
          cwd: this.chainlinkDir,
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        });
        return stdout.trim() || null;
      } catch (err) {
        const code = (err as any)?.code;
        if (code === "ENOENT") return null;
        if ((err as any)?.killed) return null;
        return null;
      }
    });
  }

  // ── Session lifecycle ────────────────────────────────────────────────

  async sessionStatus(): Promise<SessionStatus | null> {
    return this.runJson<SessionStatus>(["session", "status", "--json"]);
  }

  async sessionStart(): Promise<void> {
    await this.runRaw(["session", "start"]);
  }

  async sessionEnd(notes?: string): Promise<void> {
    const args = ["session", "end"];
    if (notes) args.push("--notes", notes);
    await this.runRaw(args);
  }

  async sessionWork(issueId: number): Promise<void> {
    await this.runRaw(["session", "work", String(issueId)]);
  }

  async sessionAction(description: string): Promise<void> {
    await this.runRaw(["session", "action", description]);
  }

  async sessionLastHandoff(): Promise<string | null> {
    return this.runRaw(["session", "last-handoff"]);
  }

  async hasActiveSession(): Promise<boolean> {
    const status = await this.sessionStatus();
    return status !== null && status.session_id > 0;
  }

  // ── Issues ───────────────────────────────────────────────────────────

  async quick(title: string, opts?: { priority?: string; label?: string }): Promise<number | null> {
    const args = ["issue", "quick", title];
    if (opts?.priority) args.push("-p", opts.priority);
    if (opts?.label) args.push("-l", opts.label);

    const stdout = await this.runRaw(args);
    if (!stdout) return null;

    // Parse "Created issue #N" or "Now working on: #N ..."
    const match = stdout.match(/#(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  async list(opts?: ListOpts): Promise<Issue[]> {
    const args = ["issue", "list", "--json"];
    if (opts?.status) args.push("-s", opts.status);
    if (opts?.priority) args.push("-p", opts.priority);
    if (opts?.label) args.push("-l", opts.label);
    const result = await this.runJson<Issue[]>(args);
    return result ?? [];
  }

  async show(id: number): Promise<Issue | null> {
    return this.runJson<Issue>(["issue", "show", String(id), "--json"]);
  }

  async close(id: number, opts?: CloseOpts): Promise<void> {
    const args = ["issue", "close", String(id)];
    if (opts?.comment) args.push("-m", opts.comment);
    await this.runRaw(args);
  }

  async comment(id: number, text: string): Promise<void> {
    await this.runRaw(["issue", "comment", String(id), text]);
  }

  async ready(): Promise<Issue[]> {
    const args = ["issue", "ready", "--json"];
    const result = await this.runJson<Issue[]>(args);
    return result ?? [];
  }

  async next(): Promise<Issue | null> {
    return this.runJson<Issue>(["issue", "next", "--json"]);
  }

  // ── Locks ────────────────────────────────────────────────────────────

  async locksList(): Promise<string | null> {
    return this.runRaw(["locks", "list"]);
  }

  async locksCheck(issueId: number): Promise<string | null> {
    return this.runRaw(["locks", "check", String(issueId)]);
  }

  async locksAcquire(issueId: number): Promise<boolean> {
    const result = await this.runRaw(["locks", "claim", String(issueId)]);
    return result !== null;
  }

  async sync(): Promise<string | null> {
    return this.runRaw(["sync"]);
  }

  // ── Agent ────────────────────────────────────────────────────────────

  async agentStatus(): Promise<string | null> {
    return this.runRaw(["agent", "status"]);
  }

  // ── Raw (for commands not yet wrapped) ───────────────────────────────

  async run(args: string[]): Promise<{ stdout: string; success: boolean }> {
    return this.enqueue(async () => {
      try {
        const { stdout } = await execFileAsync(this.binaryPath, args, {
          cwd: this.chainlinkDir,
          timeout: 5000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        });
        return { stdout, success: true };
      } catch (err: any) {
        return { stdout: err?.stdout || err?.message || "", success: false };
      }
    });
  }
}
