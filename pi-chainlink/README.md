# pi-chainlink

Integrates [Chainlink](https://github.com/riziles/pi-chainlink) — the agent-agnostic issue tracker — with the [pi coding agent](https://pi.dev). Provides session context injection, behavioral rule enforcement, and workflow guardrails.

## Install

```bash
pi install git:github.com/riziles/pi-chainlink
```

Or from npm (coming soon):

```bash
pi install npm:pi-chainlink
```

## Prerequisites

- **chainlink CLI** (`chainlink.exe` on your PATH) — download from [GitHub Releases](https://github.com/riziles/pi-chainlink/releases)
- **pi** >= 0.37.3

## What It Does

Once installed, the extension activates automatically in any directory that has a `.chainlink/` folder (created by `chainlink init`).

### Session Context

On session start, the extension injects the current chainlink session state into pi's context:

- Active session and working issue
- Previous session handoff notes
- Ready (unblocked) issues
- Coding rules from `.chainlink/rules/`
- Workflow reminders

### Tool Call Enforcement

Prevents writing, editing, or running arbitrary bash commands without an active chainlink issue:

| Tracking Mode | Behavior |
|---|---|
| **strict** | Blocks write/edit/bash without active issue |
| **normal** | Warns but doesn't block |
| **relaxed** | No enforcement |

Additionally:

- **Git write commands** (`push`, `commit`, `merge`, etc.) are **permanently blocked** in all modes
- **Shell bypasses** (`eval`, `bash -c`, `sh -c`, `source`) are blocked in strict and normal modes
- **Rule files** (`.chainlink/hook-config.json`, `.chainlink/rules/`) are protected from modification
- **Lock conflicts** are detected and blocked in strict mode

### Stub Detection

After every write/edit, checks for stubs (`TODO`, `FIXME`, `unimplemented!()`, `pass`, `...`, `NotImplementedError`) and warns if found.

### Prompt Guard

Tracks how many prompts pass without chainlink usage and reminds the agent to update issue status every 5 prompts.

## Configuration

All configuration lives in `.chainlink/hook-config.json` (created by `chainlink init`):

```json
{
  "tracking_mode": "strict",
  "blocked_git_commands": ["git push", "git commit", ...],
  "allowed_bash_prefixes": ["chainlink ", "git status", "npm test", ...]
}
```

## Skills

This package includes a `chainlink-guide` skill that loads the full chainlink workflow reference. It activates automatically when the agent works on chainlink-tracked projects.

## Prompt Templates

`/chainlink-session` — starts a chainlink session, syncs lock state, and shows ready issues.

## Development

```bash
npm install
npx vitest run          # 51 tests
npx vitest              # watch mode
```
