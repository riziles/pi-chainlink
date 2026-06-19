# pi-chainlink — Project Plan

## Overview

A pi package that integrates Chainlink (the agent-agnostic issue tracker) with the pi coding agent harness. Provides session context injection, behavioral rule enforcement, and workflow guardrails — equivalent to what Chainlink's native Claude Code hooks provide, but built for pi's extension system.

**Target:** Off-the-shelf installable via `pi install git:github.com/<org>/pi-chainlink` or `pi install npm:@<scope>/pi-chainlink`.

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│              chainlink CLI (Rust binary)          │
│                                                  │
│  • Issue tracking (create, list, close, etc.)    │
│  • Session management (start, status, end)       │
│  • SQLite database (.chainlink/issues.db)        │
│  • Configuration (.chainlink/hook-config.json)   │
│  • Rules (.chainlink/rules/*.md)                 │
│  • Context provider (integrations/context-       │
│    provider.py — agent-agnostic injection)       │
├──────────────────────────────────────────────────┤
│               pi-chainlink package               │
│                                                  │
│  ┌────────────────┐  ┌────────────────────────┐  │
│  │ Extension      │  │ Injected Rules Context  │  │
│  │ (TypeScript)   │  │ (via before_agent_start) │  │
│  │                │  │                        │  │
│  │ • work-check   │  │ • Global rules          │  │
│  │ • session-lc   │  │ • Language rules        │  │
│  │ • post-edit    │  │ • Tracking mode rules   │  │
│  │ • prompt-guard │  │ • Quality/rigor rules   │  │
│  │ • context      │  │ • Session state         │  │
│  └────────────────┘  │ • Open/ready issues     │  │
│                       │ • Workflow reminders    │  │
│  ┌────────────────┐  └────────────────────────┘  │
│  │ Prompt Template │                              │
│  │ /chainlink-     │                              │
│  │   session       │                              │
│  └────────────────┘                              │
└──────────────────────────────────────────────────┘
```

---

## Phase 1: Project Scaffold & CLI Client

**Goal:** Project structure, build setup, and a reliable TypeScript wrapper around the `chainlink` binary.

### 1.1 Repository Setup

```
pi-chainlink/
├── package.json
├── tsconfig.json
├── README.md
├── .gitignore
├── src/
│   ├── extension.ts
│   ├── config.ts
│   ├── client.ts
│   ├── discovery.ts
│   ├── context.ts
│   └── hooks/
│       ├── work-check.ts
│       ├── session.ts
│       ├── post-edit.ts
│       └── prompt-guard.ts
├── prompts/
│   └── chainlink-session.md
├── skills/
│   └── chainlink-guide/
│       └── SKILL.md
└── tests/
    ├── client.test.ts
    ├── config.test.ts
    └── hooks/
        └── work-check.test.ts
```

### 1.2 package.json

```json
{
  "name": "pi-chainlink",
  "version": "0.1.0",
  "description": "Chainlink issue tracking integration for the pi coding agent",
  "license": "MIT",
  "pi": {
    "extensions": ["./src/extension.ts"],
    "skills": ["./skills/"],
    "prompts": ["./prompts/"]
  },
  "dependencies": {
    "typebox": "^0.12.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^3.0.0",
    "@earendil-works/pi-coding-agent": "*"
  }
}
```

### 1.3 ChainlinkClient (`src/client.ts`)

Promise-based wrapper around `chainlink` subprocess calls. Returns parsed results, not raw stdout.

```typescript
class ChainlinkClient {
  constructor(chainlinkDir: string);

  // Session lifecycle
  sessionStatus(): Promise<SessionStatus | null>;
  sessionStart(): Promise<void>;
  sessionEnd(notes?: string): Promise<void>;
  sessionWork(issueId: number): Promise<void>;
  sessionAction(description: string): Promise<void>;
  sessionLastHandoff(): Promise<string | null>;
  hasActiveSession(): Promise<boolean>;

  // Issues
  quick(title: string, opts?: { priority?: string; label?: string }): Promise<number>;
  list(opts?: ListOpts): Promise<Issue[]>;
  show(id: number): Promise<Issue | null>;
  close(id: number, opts?: CloseOpts): Promise<void>;
  comment(id: number, text: string): Promise<void>;
  ready(): Promise<Issue[]>;
  next(): Promise<Issue | null>;

  // Locks
  locksList(): Promise<string | null>;
  locksCheck(issueId: number): Promise<string | null>;
  locksAcquire(issueId: number): Promise<boolean>;
  sync(): Promise<string | null>;

  // Agent
  agentStatus(): Promise<string | null>;

  // Raw (for commands not yet wrapped)
  run(args: string[]): Promise<{ stdout: string; success: boolean }>;
}
```

**Implementation notes:**
- Uses `child_process.execFile` (not `exec`) — no shell injection
- All operations are async (Promise-based) — never use `execSync`/`readFileSync` in event handlers (blocks pi's event loop)
- 5-second default timeout, configurable
- Internal request queue / mutex serializes CLI operations to prevent SQLite lock contention from parallel calls
- Caches binary path after first discovery (check `hook-config.json`, then PATH, then `~/.cargo/bin`)
- All methods handle the binary-not-found case gracefully (return null/empty, don't throw)
- `quick()` parameters `priority` and `label` are optional (default to chainlink's defaults)

### 1.4 Project Discovery (`src/discovery.ts`)

```typescript
function findChainlinkDir(startDir: string): string | null;
function findChainlinkBinary(chainlinkDir: string | null): string;
```

- Walk up from `startDir` looking for `.chainlink/hook-config.json`
- Skip stray `.chainlink/` dirs without `hook-config.json`
- Handle git worktrees (resolve to main repo root)
- Binary discovery: check `hook-config.json` → PATH → `~/.cargo/bin/chainlink`

### 1.5 Configuration Reader (`src/config.ts`)

```typescript
interface ChainlinkConfig {
  tracking_mode: "strict" | "normal" | "relaxed";
  blocked_git_commands: string[];
  allowed_bash_prefixes: string[];
}

function loadConfig(chainlinkDir: string): ChainlinkConfig;
```

- Reads `.chainlink/hook-config.json`
- Falls back to hardcoded defaults if file missing
- No local override merging (chainlink doesn't have `.local` files like crosslink does)

---

## Phase 2: Context Injection

**Goal:** Inject Chainlink session state, issues, rules, and project structure into pi's context on session start and after compaction.

### 2.1 Context Builder (`src/context.ts`)

**Note:** chainlink v0.2.0 does not include `integrations/context-provider.py`.
Context is built from direct rule loading and CLI output only.

```typescript
function getRuleContent(chainlinkDir: string, trackingMode: string): string;
function buildContext(chainlinkDir: string, client: ChainlinkClient): Promise<string>;
```

- Reads `.chainlink/rules/global.md` (always)
- Detects project languages and reads matching rule files (e.g., `python.md`, `typescript.md`)
- Reads the mode-specific tracking rule (`tracking-strict.md`, etc.)
- Calls `client.sessionStatus()` and `client.ready()` for session state and issue lists
- Wraps in `<chainlink-session-context>` XML block
- Cached for 30 seconds to avoid re-running on rapid session events

### 2.2 Injection Points

```typescript
let storedContext: string | null = null;
let lastContextTime = 0;
const CONTEXT_STALENESS_MS = 5 * 60 * 1000; // Re-fresh after 5 minutes

// On session start — load and store context
pi.on("session_start", async (event, ctx) => {
  const chainlinkDir = findChainlinkDir(ctx.cwd);
  if (!chainlinkDir) return;

  const client = new ChainlinkClient(chainlinkDir);

  // Auto-handle session lifecycle
  await handleSessionLifecycle(client);

  // Generate context for injection
  storedContext = await buildContext(chainlinkDir, client);
  lastContextTime = Date.now();
});

// Before each agent turn — inject stored context (with freshness check)
pi.on("before_agent_start", async (event, ctx) => {
  if (!storedContext) return;

  // Re-generate context if stale (handles compaction + long sessions)
  const chainlinkDir = findChainlinkDir(ctx.cwd);
  if (chainlinkDir && Date.now() - lastContextTime > CONTEXT_STALENESS_MS) {
    const client = new ChainlinkClient(chainlinkDir);
    storedContext = await buildContext(chainlinkDir, client);
    lastContextTime = Date.now();
  }

  return {
    message: {
      customType: "chainlink-context",
      content: storedContext,
      display: true,
    },
  };
});
```

**Compaction handling:** Context is re-generated when older than 5 minutes (via `CONTEXT_STALENESS_MS`).
Additionally, listen for `session_compact` event to force immediate re-generation.
This covers the case where pi compacts context and earlier injected messages are lost.
After compaction, the model sees fresh session state on the very next turn without waiting for the timer.

**Lightweight updates:** To avoid token bloat on every turn, only re-inject the full context block
when something changed (new comment, issue switch, compaction). Use incremental `<chainlink-session-update>`
blocks for minor changes like timer ticks.

**What the injected context looks like:**

```xml
<chainlink-session-context>
## Session
Session #12 active (started 2026-06-19 14:30)
Working on: #8 Add user authentication flow
Last action: Investigating OAuth2 token refresh logic

## Previous Session Handoff
Completed login endpoint. Token refresh is next. Found rate-limiting issue in /api/auth.

## Ready Issues (unblocked)
  #8    high     Add user authentication flow
  #15   medium   Add dark mode toggle

## Open Issues
  #8    high     Add user authentication flow
  #18   low      Update API documentation

## Coding Rules
### General Requirements
1. **NO STUBS**: Never write placeholder comments, empty bodies...
2. **ERROR HANDLING**: Proper error handling everywhere...
### TypeScript Best Practices
- Enable strict mode in tsconfig.json
- Use explicit return types on functions
...

## Workflow
- Use `chainlink session start` at the beginning of work
- Use `chainlink session work <id>` to mark current focus
- Add comments: `chainlink comment <id> "..."`
- End with notes: `chainlink session end --notes "..."`
</chainlink-session-context>
```

### 2.3 Session Lifecycle Handling (`src/hooks/session.ts`)

```typescript
async function handleSessionLifecycle(client: ChainlinkClient): Promise<void>;
```

- Check for stale session (>4 hours idle) → auto-end with note
- If no active session → auto-start one
- If resuming after context compression → auto-comment on active issue with `[auto]` breadcrumb
- When `sessionWork` is called on an issue → auto-acquire lock via `chainlink lock <id>`
- Always run `chainlink sync` (best-effort, non-blocking)

**Lock acquisition on session work:** Prevents two pi instances from accidentally working
on the same issue. Lock is acquired automatically on `sessionWork()` — the extension wraps
the call with `client.locksAcquire(issueId)`.

### 2.5 chainlink init — What Gets Created

Verified against chainlink v0.2.0. `chainlink init` creates:

```
.chainlink/
├── .gitignore
├── hook-config.json          # tracking_mode, blocked_git_commands, allowed_bash_prefixes
├── issues.db                 # SQLite database
├── rules/                    # Language-specific and mode-specific rule files (*.md, *.txt)
└── rules.local/              # Gitignored per-machine overrides
.claude/
├── hooks/                    # Python hook scripts for Claude Code (work-check.py, etc.)
│   ├── chainlink_config.py
│   ├── post-edit-check.py
│   ├── pre-web-check.py
│   ├── prompt-guard.py
│   ├── session-start.py
│   └── work-check.py
├── mcp/
│   └── safe-fetch-server.py
└── settings.json             # Claude Code hook configuration
```

**Key findings:**
- No `integrations/` directory — no `context-provider.py`. The plan's Strategy 1 (Python bridge) is not
  available in the current chainlink release. Context must be built from direct rule loading and CLI output.
- `hook-config.json` defaults to `tracking_mode: "strict"` with blocked git commands and allowed bash prefixes.
- `.claude/` directory is specific to Claude Code — pi extension ignores these files.
- Protected paths: `.chainlink/hook-config.json` and `.chainlink/rules/` (not `.claude/` for pi).
- `chainlink issue quick` is the actual command (not `chainlink quick`).
- JSON output available via `--json` flag on `list`, `show`, `search`, `session status`.
- Locks require a git repository (worktree-based implementation).

### 2.6 Configuration Validation

On first load, if no `.chainlink/` directory found:

```typescript
const shouldInit = await ctx.ui.confirm(
  "Chainlink not initialized",
  "Initialize Chainlink issue tracking for this project? This runs `chainlink init`."
);
if (shouldInit) {
  execFileSync("chainlink", ["init"], { cwd: ctx.cwd, stdio: "inherit" });
}
```

---

## Phase 3: Work-Check Hook (Tool Call Enforcement)

**Goal:** Mirror Chainlink's `work-check.py` Claude Code hook as a pi `tool_call` event handler. This is the core enforcement mechanism.

### 3.1 Event Handler (`src/hooks/work-check.ts`)

```typescript
pi.on("tool_call", async (event, ctx) => {
  // Only intercept write, edit, bash
  if (!["write", "edit", "bash"].includes(event.toolName)) return;

  const chainlinkDir = findChainlinkDir(ctx.cwd);
  if (!chainlinkDir) return; // Not a chainlink project — allow

  const config = loadConfig(chainlinkDir);
  const client = new ChainlinkClient(chainlinkDir);
  const input = event.input;

  // ── Guard 1: Protect hook infrastructure ──
  if (event.toolName === "write" || event.toolName === "edit") {
    const path = normalizePath(input.file_path || input.path || "");
    if (isProtectedPath(path, chainlinkDir)) {
      return {
        block: true,
        reason: "Modifying chainlink hook infrastructure (.chainlink/hook-config.json, " +
                ".claude/hooks/, .claude/settings.json) is permanently forbidden. " +
                "These files control project safety constraints."
      };
    }
  }

  // ── Guard 2: Blocked git commands (permanent block, all modes) ──
  if (event.toolName === "bash" && isBlockedGit(input.command, config.blocked_git_commands)) {
    return {
      block: true,
      reason: "Git mutation commands (push, commit, merge, rebase, reset, etc.) are " +
              "PERMANENTLY FORBIDDEN. The human performs all git write operations.\n\n" +
              "Read-only git commands (status, diff, log, show, branch) are allowed."
    };
  }

  // ── Guard 3: Allow-listed bash (always pass) ──
  if (event.toolName === "bash" && isAllowedBash(input.command, config.allowed_bash_prefixes)) {
    return;
  }

  // ── Guard 4: Relaxed mode — skip issue enforcement ──
  if (config.tracking_mode === "relaxed") return;

  // ── Guard 5: Check for active issue ──
  const status = await client.sessionStatus();
  if (!status || !status.activeIssue) {
    const msg = config.tracking_mode === "strict"
      ? "MANDATORY: You must have an active chainlink issue before writing, editing, " +
        "or running bash commands.\n\n" +
        "Create one: chainlink quick \"<describe the work>\" -p <priority> -l <label>\n" +
        "Or pick existing: chainlink list -s open && chainlink session work <id>"
      : "Reminder: No active chainlink issue. Consider creating one before making changes.";

    if (config.tracking_mode === "strict") {
      return { block: true, reason: msg };
    }
    ctx.ui.notify(msg, "warn");
    return;
  }

  // ── Guard 6: Lock conflict check ──
  if (status.activeIssue) {
    const lockResult = await client.locksCheck(status.activeIssue);
    if (lockResult && lockResult.includes("locked by") &&
        !lockResult.includes(ourAgentId)) {
      const msg = `Lock conflict: Issue #${status.activeIssue} is ${lockResult}. ` +
                  "Another agent has claimed this issue.";
      if (config.tracking_mode === "strict") {
        return { block: true, reason: msg };
      }
      ctx.ui.notify(`Warning: ${msg}`, "warn");
    }
  }
});
```

### 3.2 Helper Functions

```typescript
// Maps tool names to their file path parameter names.
// Pi's built-in tools use `file_path` for write, `path` for edit.
// Extend this map if custom tools with file path params are added.
const TOOL_FILE_PATH_PARAMS: Record<string, string[]> = {
  write: ["file_path", "path"],
  edit: ["file_path", "path"],
};

function getFilePathFromTool(toolName: string, input: Record<string, unknown>): string | null;
  // Looks up TOOL_FILE_PATH_PARAMS and tries each candidate key

function isProtectedPath(filePath: string, chainlinkDir: string): boolean;
  // Blocks: hook-config.json, .claude/hooks/*, .claude/settings.json
  // Uses path normalization for cross-platform matching

function isBlockedGit(command: string, blockedList: string[]): boolean;
  // Normalizes git commands (strips -C, --git-dir flags)
  // Checks for chained commands (&&, ;, |)
  // Matches against blocked list

function isAllowedBash(command: string, allowedList: string[]): boolean;
  // Splits on &&, ;, | — EVERY subcommand must be allowed
  // Prevents bypass via "allowed_cmd && malicious_cmd"
  // NOTE: Simple string matching is prone to bypasses (eval, variable expansion, subshells).
  // For strict enforcement, use a tokenizer/parser to extract all command invocations.
  // Known limitations: eval, `bash -c`, command substitution, aliases.
  // Mitigation: block `eval`, `bash -c`, `sh -c`, `source`/`.`, and `exec` in strict mode.
```

### 3.3 Differences from Chainlink's work-check.py

| Chainlink (Python hook) | chainlink-pi (TypeScript extension) |
|---|---|
| stdin JSON, exit code 2 for block | `tool_call` event, `{ block: true }` return |
| stderr for block messages | `block.reason` shown to model by pi |
| Runs as subprocess per tool call | Runs in-process (faster, no spawn overhead) |
| `tool_name` from JSON | `event.toolName` from pi event |
| `tool_input.file_path` | `event.input.file_path` or `event.input.path` |
| `tool_input.command` | `event.input.command` |
| Prints warning to stdout | `ctx.ui.notify()` for warnings |
| Only tracks strict ↔ exit 2 | Maps to pi's block/warn/allow semantics |

---

## Phase 4: Post-Edit Hook (Stub Detection)

**Goal:** After every write/edit, check for stubs and warn.

### 4.1 Event Handler (`src/hooks/post-edit.ts`)

```typescript
pi.on("tool_result", async (event, ctx) => {
  if (!["write", "edit"].includes(event.toolName)) return;

  // Read the file that was just written/edited
  const filePath = event.input.file_path || event.input.path;
  if (!filePath) return;

  try {
    const content = readFileSync(filePath, "utf-8");
    const stubs = detectStubs(content);

    if (stubs.length > 0) {
      ctx.ui.notify(
        `Stubs detected in ${path.basename(filePath)}: ${stubs.join(", ")}. ` +
        `Implement complete code, not placeholders.`,
        "warn"
      );
    }
  } catch {
    // File may not exist yet (write creates it) — skip
  }
});
```

### 4.2 Stub Detection

```typescript
function detectStubs(content: string): string[];
```

Scans for:
- `TODO` comments (bare, not `TODO(username):`)
- `FIXME` comments
- `HACK` comments
- `unimplemented!()` (Rust)
- `pass` in function bodies (Python, but only in obviously-empty functions)
- `...` as a standalone statement
- `throw new Error("Not implemented")` / `raise NotImplementedError`

Returns the list of detected stub types for the notification message.

**Debouncing:** Only runs once per file per 60 seconds to avoid spamming on rapid edits.

**Implementation note:** File reads must be async (`fs.promises.readFile`) to avoid blocking pi's event loop.

---

## Phase 5: Prompt-Guard Hook (Drift Detection)

**Goal:** Track how many prompts pass without chainlink usage and remind the agent periodically.

### 5.1 Event Handler (`src/hooks/prompt-guard.ts`)

```typescript
// Track prompts since last chainlink usage.
// Note: counter is in-memory only — resets on process restart.
// This is acceptable since pi sessions typically don't survive restarts.
let promptsSinceChainlink = 0;
const REMINDER_THRESHOLD = 5;

pi.on("tool_call", async (event, ctx) => {
  // If the agent calls a chainlink command, reset counter
  if (event.toolName === "bash" && event.input.command?.startsWith("chainlink ")) {
    promptsSinceChainlink = 0;
  }
});

pi.on("before_agent_start", async (event, ctx) => {
  promptsSinceChainlink++;

  if (promptsSinceChainlink >= REMINDER_THRESHOLD) {
    ctx.ui.notify(
      `Chainlink reminder: ${promptsSinceChainlink} prompts since last chainlink usage. ` +
      `Consider updating your issue: chainlink comment <id> "progress update"`,
      "info"
    );
    promptsSinceChainlink = 0; // Reset after reminding
  }
});
```

---

## Phase 6: Skills & Prompts

### 6.1 Chainlink Guide Skill (`skills/chainlink-guide/SKILL.md`)

A pi skill that loads the full chainlink workflow reference. Ported from chainlink's `CLAUDE.md`, adapted for pi:

```markdown
---
name: chainlink-guide
description: Chainlink issue tracker workflow. Use when working on chainlink-tracked projects — creating issues, managing sessions, tracking work across conversations.
---

# Chainlink Issue Tracker

Track tasks across AI sessions. Data in `.chainlink/issues.db`.

## Commands
[full command reference from chainlink CLAUDE.md]

## Workflow
1. `chainlink session start` → see previous handoff
2. `chainlink session work <id>` → mark focus
3. Work, add comments: `chainlink comment <id> "..." `
4. `chainlink session end --notes "..."` → save context

## Best Practices
- Start sessions when beginning work
- Use `chainlink ready` to find unblocked issues
- Use subissues for tasks >500 lines
- End with handoff notes before context compresses
```

### 6.2 Prompt Template (`prompts/chainlink-session.md`)

```markdown
Start a chainlink session for this work. Review previous handoff notes, 
sync lock state, and show open and ready issues. Report the current state.

Run:
- chainlink session start
- chainlink sync
- chainlink ready
- chainlink list
```

---

## Phase 7: Testing

### 7.1 Unit Tests

**`tests/config.test.ts`:**
- `loadConfig` returns defaults when no file exists
- `loadConfig` parses valid JSON
- `loadConfig` handles malformed JSON gracefully
- `loadConfig` returns correct tracking modes

**`tests/client.test.ts`:**
- `sessionStatus` parses real output
- `quick` returns issue ID
- Handles binary-not-found gracefully
- Handles command timeouts

**`tests/hooks/work-check.test.ts`:**
- `isBlockedGit` matches simple and chained commands
- `isBlockedGit` handles git global flags
- `isAllowedBash` requires all subcommands in chain to match
- `isProtectedPath` matches hook infrastructure paths
- `isProtectedPath` handles Windows and Unix paths

### 7.2 Integration Test Strategy

- Test against a real project with `chainlink init` run in a temp directory
- Create issues, start sessions, verify context generation
- Verify work-check blocks in strict mode with no active issue
- Verify work-check allows in relaxed mode
- Test with `context-provider.py` present and absent

### 7.3 Manual Test Checklist

- [ ] `pi install git:...` succeeds
- [ ] On session start in a chainlink project, context is injected
- [ ] In strict mode, write/edit/bash blocked without active issue
- [ ] In normal mode, warning shown but not blocked
- [ ] In relaxed mode, no enforcement
- [ ] Git push/commit/rebase permanently blocked
- [ ] `git status`/`git diff` always allowed
- [ ] Stub detection fires on `TODO`/`FIXME`
- [ ] Works without `context-provider.py` (falls back to direct rule loading)
- [ ] Works without Python installed (context-provider skipped, still functional)

---

## Phase 8: Documentation & Distribution

### 8.1 README.md

- What chainlink-pi is and why you'd use it
- Prerequisites (chainlink CLI, Python 3.6+ optional for context-provider)
- Installation (`pi install`)
- Usage (automatic — just works in chainlink-initialized projects)
- Configuration (tracking mode, blocked commands, allowed bash)
- How it maps to Chainlink's Claude Code hooks
- Troubleshooting

### 8.2 Distribution

**Primary:** npm package `pi-chainlink`
```bash
pi install npm:pi-chainlink
```

**Alternative:** git install
```bash
pi install git:github.com/<org>/pi-chainlink
```

### 8.3 Version Compatibility

- Chainlink CLI >= 0.2.0 (current)
- pi >= current stable
- Node.js >= 18 (for pi)
- No Python dependency (context is built from CLI + rule files, not context-provider.py)

---

## Implementation Order

| Step | Phase | Effort | What |
|---|---|---|---|
| 1 | 1.1–1.5 | S | Scaffold repo, package.json, tsconfig |
| 2 | 1.3 | M | ChainlinkClient — the CLI wrapper |
| 3 | 1.4–1.5 | S | Discovery + config reader |
| 4 | 2.1 | M | Context provider integration |
| 5 | 2.2–2.4 | M | Context injection + session lifecycle (incl. lock acquisition) |
| 6 | 3.1–3.2 | L | Work-check hook — the core enforcement |
| 7 | 4 | S | Post-edit stub detection |
| 8 | 5 | S | Prompt-guard drift detection |
| 9 | 6 | S | Skills + prompt templates |
| 10 | 7 | M | Tests |
| 11 | 8 | S | README + distribution setup |
| 12 | — | S | End-to-end manual testing |
| 0 | — | S | Verify chainlink CLI output formats (done) |

**Total estimate:** ~2–3 days of focused work. The heavy lift is the work-check hook (step 6); everything else is straightforward.

**Pre-work completed:**
- [x] Verified `chainlink init` output structure (no `context-provider.py`, `.claude/` is Claude-specific)
- [x] Verified JSON output formats (`--json` flag on list, show, search, session status)
- [x] Verified command names (`chainlink issue quick` not `chainlink quick`)
- [x] Verified `hook-config.json` defaults (strict mode, blocked git commands, allowed prefixes)
- [x] Verified locks require git repo (not available in non-git directories)

---

## Future Enhancement: Native pi Tools for Chainlink Commands

**Current plan:** The extension relies on the agent executing `chainlink` CLI commands via the `bash` tool.
This adds latency (subprocess spawn) and requires the agent to remember CLI syntax.

**Future enhancement:** Register native pi tools for core Chainlink operations:

```typescript
// Example: native pi tools that wrap ChainlinkClient internally
pi.registerTool({
  name: "chainlink_status",
  description: "Get current Chainlink session status",
  parameters: Type.Object({}),
  execute: async () => {
    const status = await client.sessionStatus();
    return { content: [{ type: "text", text: JSON.stringify(status) }], details: {} };
  },
});

pi.registerTool({
  name: "chainlink_comment",
  description: "Add a comment to a Chainlink issue",
  parameters: Type.Object({
    issueId: Type.Number(),
    text: Type.String(),
  }),
  execute: async (_id, params) => {
    await client.comment(params.issueId, params.text);
    return { content: [{ type: "text", text: `Comment added to #${params.issueId}` }], details: {} };
  },
});
```

**Benefits:**
- Faster (in-process, no subprocess spawn)
- Schema-validated parameters (issue IDs, priority, labels)
- No CLI syntax errors
- Cleaner agent prompts (fewer `bash` calls cluttering conversation)

**When to implement:** Phase 9 — after the core extension is stable. The CLI-based approach works well
for initial development and keeps the Phase 1-8 scope manageable.

---

## pi API Verified Types

**Verified against pi v0.79.1 TypeScript types.** These are the exact field names and event signatures.

### Tool input field names

| Tool | File path field | Other fields |
|------|----------------|-------------|
| `write` | `event.input.path` | `event.input.content` |
| `edit` | `event.input.path` | `event.input.edits[].oldText`, `.newText` |
| `read` | `event.input.path` | `event.input.offset?`, `event.input.limit?` |
| `bash` | (n/a) | `event.input.command`, `event.input.timeout?` |

**Key finding:** `write` uses `path`, not `file_path`. The plan's `file_path || path` fallback
handles this, but the primary field for `write` is `path`.

### Context injection API

`before_agent_start` returns `{ message }`, **not** `{ injectMessages }`. The message is a
custom message stored in the session:

```typescript
return {
  message: {
    customType: "chainlink-context",
    content: storedContext,  // string shown to the model
    display: true,           // show in TUI
  },
};
```

### Compaction event

The compaction event is `session_compact` (not `compaction_end`):

```typescript
pi.on("session_compact", async (event, ctx) => {
  // event.compactionEntry - the saved compaction
  // event.fromExtension - whether extension provided it
  // Re-generate context here
});
```

### isToolCallEventType type guard

pi provides `isToolCallEventType` for typed tool call event handling:

```typescript
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

pi.on("tool_call", async (event, ctx) => {
  if (isToolCallEventType("write", event)) {
    // event.input is typed as { path: string; content: string }
    console.log(event.input.path);
  }
});
```

---

## Concurrency & Event Loop Notes

**Async-required context:** All event handlers in pi extensions run on the main event loop.
Synchronous operations (`execSync`, `readFileSync`, blocking I/O) will freeze the TUI and
block other event handlers.

**Rules:**
1. All file I/O uses `fs.promises` (async)
2. All subprocess calls use `child_process.execFile` wrapped in promises
3. Never call `execSync` or `readFileSync` inside `pi.on(...)` handlers

**SQLite contention:** Chainlink uses SQLite (`.chainlink/issues.db`). If pi fires multiple
parallel tool calls in one turn, `ChainlinkClient` must serialize operations through an
internal mutex/queue to avoid `database is locked` errors.

```typescript
class ChainlinkClient {
  private queue: Promise<void> = Promise.resolve();

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn, fn); // skip rejections to keep queue alive
    this.queue = result.catch(() => {});
    return result;
  }
}
```

---

## Design Decisions

1. **Context is built from chainlink CLI + rule files.** chainlink v0.2.0 does not ship `context-provider.py`. Context injection uses `--json` output from CLI commands (session status, ready, list) combined with direct rule file loading. If future releases add a context provider, it becomes an optional enrichment source.

2. **No MCP, no subprocess hooks.** Pi's extension model is in-process TypeScript with event handlers. We don't try to port the Python hook scripts — we implement the same logic natively.

3. **hook-config.json is the single config source.** We read chainlink's existing config file. No new configuration surface. If you've configured chainlink for Claude Code, the same settings apply to pi.

4. **No init — project setup is chainlink's job.** The extension detects `.chainlink/` directories and offers to run `chainlink init` if missing, but doesn't create its own config files.

5. **Fail-open on errors.** If the chainlink binary isn't found or times out, the extension degrades gracefully (no enforcement, no context injection) rather than breaking pi.

6. **Minimal dependencies.** No runtime dependencies required. `typebox` is used for native tool parameter schemas (Future Enhancement section). Everything else is Node.js built-ins + pi's extension API.

7. **Lock acquisition with session work.** When the extension calls `session work <id>`, it auto-acquires a lock on that issue via `chainlink lock <id>`. This prevents two pi instances from conflicting on the same issue.

8. **Chainlink binary distribution.** The chainlink CLI Windows binary (`chainlink.exe`) is published via GitHub Actions on tagged releases and downloadable from [GitHub Releases](https://github.com/riziles/pi-chainlink/releases). The pi extension discovers it via PATH, hook-config.json, or `~/.cargo/bin`.

9. **All async event handlers.** No synchronous I/O in any `pi.on(...)` handler. File reads use `fs.promises`, subprocess calls use async `execFile`. See Concurrency & Event Loop Notes above.
