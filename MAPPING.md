# Upstream Source Map

This documents the relationship between our fork (`riziles/pi-chainlink`)
and the upstream chainlink repo (`dollspace-gay/chainlink`), so a maintainer
can update both sides in sync.

```bash
# Our fork
git remote add origin https://github.com/riziles/pi-chainlink
# True upstream (where the Rust CLI + Python hooks come from)
git remote add upstream https://github.com/dollspace-gay/chainlink
```

## Repo Layout

Our fork adds `pi-chainlink/` (TypeScript extension) on top of upstream.
Everything outside `pi-chainlink/` is upstream code, with a few additive
changes (see [Rust CLI changes](#chainlink-rust-cli-changes)).

```
pi-chainlink/                          ← OUR FORK root
├── chainlink/                         ← UPSTREAM: Rust CLI
│   ├── src/                           ← we've added ~3 files here
│   ├── resources/claude/hooks/*.py   ← UPSTREAM: Claude Code hooks (VERBATIM)
│   ├── resources/chainlink/           ← UPSTREAM: rules + config (mostly verbatim)
│   │   └── integrations/              ← OUR ADDITION: context-provider.py
│   └── ...                            ← the rest is upstream
│
├── pi-chainlink/                      ← OUR ADDITION: pi extension package
│   ├── src/
│   │   ├── extension.ts              ← OUR: pi lifecycle wiring
│   │   ├── context.ts                ← PORTED: rule loading from prompt-guard.py
│   │   ├── client.ts                 ← OUR: chainlink CLI wrapper
│   │   ├── config.ts                 ← PORTED: from chainlink_config.py
│   │   ├── discovery.ts              ← PORTED: from chainlink_config.py
│   │   ├── tools.ts                  ← OUR: native pi tools (no upstream eq)
│   │   └── hooks/
│   │       ├── work-check.ts         ← PORTED: from hooks/work-check.py
│   │       ├── session.ts            ← PORTED: from hooks/session-start.py
│   │       ├── prompt-guard.ts       ← DIVERGED: from hooks/prompt-guard.py
│   │       └── post-edit.ts          ← PORTED: from hooks/post-edit-check.py
│   ├── prompts/
│   └── skills/
│
├── .claude/hooks/                     ← UPSTREAM: deployed runtime copies
├── .chainlink/                        ← RUNTIME: state + rules + integrations
└── vscode-extension/                  ← UPSTREAM (unmodified)
```

## Hook Source Map

### ✅ Ported (direct 1:1 translations from Python → TypeScript)

| Upstream Python | Our TypeScript | Notes |
|---|---|---|
| `chainlink/resources/claude/hooks/work-check.py` | `pi-chainlink/src/hooks/work-check.ts` | Work-check enforcement after every tool call. Blocks Write/Edit/Bash without active issue. Guards hook-config.json, rules, blocked git commands. |
| `chainlink/resources/claude/hooks/session-start.py` | `pi-chainlink/src/hooks/session.ts` | Auto-starts sessions on first prompt, loads handoff notes, acquires locks. |
| `chainlink/resources/claude/hooks/post-edit-check.py` | `pi-chainlink/src/hooks/post-edit.ts` | Detects stub patterns (TODO, FIXME, etc.) after Write/Edit tool results. |
| `chainlink/resources/claude/hooks/chainlink_config.py` | `pi-chainlink/src/config.ts` + `pi-chainlink/src/discovery.ts` | Shared utilities: find_chainlink_dir, load_config, tracking mode. |

### ⚠️ Diverged (ported but with intentional differences)

| Upstream | Our Version | Why different |
|---|---|---|
| `hooks/prompt-guard.py` — full/condensed model on every prompt | `hooks/prompt-guard.ts` — counter-based nag (5 prompts), plus native tool integration | pi's `before_agent_start` event model differs from Claude Code's `--pre-prompt` hook. Upstream sends full rules once + condensed thereafter. We inject context separately and use a counter to catch agent drift. |
| `hooks/prompt-guard.py` — rule loading / context assembly | `src/context.ts` — separate context builder | Upstream builds rules inline in the prompt hook. We build a `<chainlink-session-context>` block for injection via `before_agent_start`. |

### ❌ Not ported

| Upstream | Reason |
|---|---|
| `hooks/pre-web-check.py` | pi handles web fetching differently — we rely on the chainlink MCP safe-fetch server from `.mcp.json` instead of a hook interceptor. |
| `vscode-extension/` | Unmodified upstream code. No pi equivalent needed. |

### 🆕 Our additions (no upstream equivalent)

| File | Purpose |
|---|---|
| `pi-chainlink/src/extension.ts` | Wires all hooks/tools to pi lifecycle events (session_start, before_agent_start, tool_call, tool_result, session_compact). |
| `pi-chainlink/src/client.ts` | TypeScript wrapper around the `chainlink` Rust CLI binary for session status, issue CRUD, locks. |
| `pi-chainlink/src/tools.ts` | Three native pi tools: `chainlink_session`, `chainlink_issue`, `chainlink_quick`. No subprocess — calls `ChainlinkClient` directly. |
| `chainlink/src/commands/context.rs` | New `chainlink context` command — shells out to context-provider.py. |
| `chainlink/resources/chainlink/integrations/context-provider.py` | Agent-agnostic context injection script. Reads rules from `.chainlink/rules/`, queries session/issues via CLI. |

## chainlink/ Rust CLI Changes

All our Rust changes are additive — no upstream files were modified in breaking ways:

| File | Change | Merge risk |
|---|---|---|
| `build.rs` | +1 `rerun-if-changed` line | None |
| `src/commands/init.rs` | `CONTEXT_PROVIDER_PY` embed + deployment to `.chainlink/integrations/` | Low — clean additions, no logic changes to existing paths |
| `src/commands/mod.rs` | +1 `pub mod context` | None |
| `src/commands/context.rs` | New file | None |
| `src/main.rs` | +Context command variant + dispatch | Low — backward-compat, enum+match variant |

## Maintainer Checklist

### On upstream release

1. **Fetch upstream tags**: `git fetch upstream`
2. **Check version drift**: `git diff upstream/main -- chainlink/Cargo.toml | grep version` — if upstream bumped the version, we need to merge
3. **Diff untouched files**: `git diff upstream/main -- chainlink/ -- ":(exclude)chainlink/src/commands/context.rs" ":(exclude)chainlink/src/commands/init.rs" ":(exclude)chainlink/src/commands/mod.rs" ":(exclude)chainlink/src/main.rs" ":(exclude)chainlink/resources/chainlink/integrations/"`
   - Any diff in non-excluded files means we accidentally modified upstream code — review and revert if unintended
4. **Diff Python hooks**: `git diff upstream/main -- chainlink/resources/claude/hooks/`
   - These should be VERBATIM (no diff). If upstream changed, review each change against our ported TypeScript counterparts (see Hook Source Map below)
4. **Port hook changes**: For each upstream hook that changed:
   - Check the corresponding TypeScript file in the Hook Source Map
   - If it's a `✅ Ported` hook, apply the same behavioral change to the TS version
   - If it's a `⚠️ Diverged` hook, evaluate whether the change applies to our model
   - Run `npx vitest run` in `pi-chainlink/` to verify
5. **Run tests**: `cd chainlink && cargo test`, then `cd pi-chainlink && npx vitest run`
6. **Merge upstream**: `git merge upstream/main` (or rebase), resolve conflicts, then push

### On adding a new upstream feature

1. Check if there's a parallel hook that needs porting
2. If the feature interacts with hooks we've ported, update both the Python originals AND our TS ports
3. Don't modify upstream Python hooks in-place — only sync changes FROM upstream TO our TS
4. New Rust commands are safe to add (we only added one module + one enum variant)

### Key invariant

**`chainlink/resources/claude/hooks/*.py` must remain identical to upstream.** These are the canonical Claude Code hooks deployed by `chainlink init`. Our pi extension is a parallel implementation for pi, not a replacement. Both must produce equivalent behavior for their respective agents.
