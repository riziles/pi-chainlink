/**
 * Native pi tools for chainlink commands.
 *
 * These tools wrap ChainlinkClient directly (no subprocess spawn via bash),
 * providing schema-validated params and faster execution than CLI invocations.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Static } from "typebox";

import { ChainlinkClient } from "./client.js";
import { findChainlinkDir, findChainlinkBinary } from "./discovery.js";

// Helpers

let cachedChainlinkDir = null;
function getClient(ctx: ExtensionContext): ChainlinkClient | null {
  const dir = cachedChainlinkDir ?? findChainlinkDir(ctx.cwd);
  if (!dir) return null;
  return new ChainlinkClient(dir, findChainlinkBinary(dir));
}

function formatIssue(i: { id: number; title: string; status: string; priority: string; created_at: string; parent_id: number | null }): string {
  const parent = i.parent_id ? ` (subissue of #${i.parent_id})` : "";
  return `#${i.id} [${i.status}] ${i.title} — ${i.priority}${parent}`;
}

// Schemas

const SessionAction = Type.Union([
  Type.Literal("status"),
  Type.Literal("work"),
  Type.Literal("end"),
]);

export const ChainlinkSessionSchema = Type.Object({
  action: SessionAction,
  issue_id: Type.Optional(Type.Number()),
  notes: Type.Optional(Type.String()),
});

export type ChainlinkSessionInput = Static<typeof ChainlinkSessionSchema>;

const IssueAction = Type.Union([
  Type.Literal("list"),
  Type.Literal("show"),
  Type.Literal("comment"),
  Type.Literal("close"),
  Type.Literal("ready"),
  Type.Literal("next"),
]);

export const ChainlinkIssueSchema = Type.Object({
  action: IssueAction,
  id: Type.Optional(Type.Number()),
  text: Type.Optional(Type.String()),
  status: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")])),
  priority: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high"), Type.Literal("critical")])),
  label: Type.Optional(Type.String()),
});

export type ChainlinkIssueInput = Static<typeof ChainlinkIssueSchema>;

const QuickPriority = Type.Union([
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("critical"),
]);

export const ChainlinkQuickSchema = Type.Object({
  title: Type.String(),
  priority: Type.Optional(QuickPriority),
  label: Type.Optional(Type.String()),
});

export type ChainlinkQuickInput = Static<typeof ChainlinkQuickSchema>;

export function setChainlinkDir(dir) { cachedChainlinkDir = dir }
export function registerTools(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    const dir = findChainlinkDir(ctx.cwd)
    if (dir) cachedChainlinkDir = dir
  })

  pi.registerTool({
    name: "chainlink_session",
    label: "Chainlink Session",
    description: "Manage chainlink session: view status, set active issue, or end session with handoff notes.",
    promptSnippet: "View chainlink session status, set active issue (work), or end session with notes.",
    promptGuidelines: [
      "Use chainlink_session with action=status at the start of every user request.",
      "Use chainlink_session with action=work to mark which issue you are working on.",
      "Use chainlink_session with action=end and notes before stopping.",
    ],
    parameters: ChainlinkSessionSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const client = getClient(ctx);
      if (!client) return { content: [{ type: "text" as const, text: "No .chainlink/ directory found." }] };
      const { action, issue_id, notes } = params as ChainlinkSessionInput;
      switch (action) {
        case "status": {
          const s = await client.sessionStatus();
          if (!s) return { content: [{ type: "text" as const, text: "No active session." }] };
          const active = s.active_issue ? `#${s.active_issue.id} \"${s.active_issue.title}\"` : "(none)";
          return { content: [{ type: "text" as const, text: `Session #${s.session_id} (${s.duration_minutes}m)\nWorking on: ${active}` }] };
        }
        case "work": {
          if (!issue_id) return { content: [{ type: "text" as const, text: "Missing issue_id" }], isError: true };
          await client.sessionWork(issue_id);
          return { content: [{ type: "text" as const, text: `Now working on issue #${issue_id}.` }] };
        }
        case "end": {
          await client.sessionEnd(notes);
          return { content: [{ type: "text" as const, text: notes ? "Session ended with handoff notes." : "Session ended." }] };
        }
        default: return { content: [{ type: "text" as const, text: `Unknown action: ${action}` }], isError: true };
      }
    },
  });

  pi.registerTool({
    name: "chainlink_issue",
    label: "Chainlink Issue",
    description: "Manage chainlink issues: list, show details, add comments, close issues, or check ready/next.",
    promptSnippet: "List, show, comment on, close, or find ready/next chainlink issues.",
    promptGuidelines: [
      "Use chainlink_issue with action=ready to find unblocked work when starting a session.",
      "Use chainlink_issue with action=list to see all open issues.",
      "Use chainlink_issue with action=show to get full issue details including comments.",
      "Use chainlink_issue with action=comment to document findings and progress.",
      "Use chainlink_issue with action=close when an issue is complete.",
    ],
    parameters: ChainlinkIssueSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const client = getClient(ctx);
      if (!client) return { content: [{ type: "text" as const, text: "No .chainlink/ directory found." }] };
      const { action, id, text, status, priority, label } = params as ChainlinkIssueInput;
      switch (action) {
        case "list": {
          const issues = await client.list({ status: status ?? "open", priority, label });
          if (issues.length === 0) return { content: [{ type: "text" as const, text: "No issues match." }] };
          return { content: [{ type: "text" as const, text: issues.map(formatIssue).join("\n") }] };
        }
        case "show": {
          if (!id) return { content: [{ type: "text" as const, text: "Missing id" }], isError: true };
          const issue = await client.show(id);
          if (!issue) return { content: [{ type: "text" as const, text: `Issue #${id} not found.` }], isError: true };
          const desc = issue.description ? `\n\n${issue.description}` : "";
          return { content: [{ type: "text" as const, text: `#${issue.id}: ${issue.title}\nStatus: ${issue.status}\nPriority: ${issue.priority}\nCreated: ${issue.created_at}${desc}` }] };
        }
        case "comment": {
          if (!id || !text) return { content: [{ type: "text" as const, text: "Missing id and text" }], isError: true };
          await client.comment(id, text);
          return { content: [{ type: "text" as const, text: `Added comment to issue #${id}.` }] };
        }
        case "close": {
          if (!id) return { content: [{ type: "text" as const, text: "Missing id" }], isError: true };
          await client.close(id, { comment: text });
          return { content: [{ type: "text" as const, text: text ? `Closed issue #${id} with comment.` : `Closed issue #${id}.` }] };
        }
        case "ready": {
          const issues = await client.ready();
          if (issues.length === 0) return { content: [{ type: "text" as const, text: "No ready (unblocked) issues." }] };
          return { content: [{ type: "text" as const, text: "Ready issues:\n" + issues.map(formatIssue).join("\n") }] };
        }
        case "next": {
          const issue = await client.next();
          if (!issue) return { content: [{ type: "text" as const, text: "No issues available." }] };
          return { content: [{ type: "text" as const, text: `Next issue: ${formatIssue(issue)}` }] };
        }
        default: return { content: [{ type: "text" as const, text: `Unknown action: ${action}` }], isError: true };
      }
    },
  });

  pi.registerTool({
    name: "chainlink_quick",
    label: "Chainlink Quick",
    description: "Create a chainlink issue and start working on it in one step. Use before writing ANY code.",
    promptSnippet: "Create a chainlink issue and start working on it immediately.",
    promptGuidelines: [
      "Use chainlink_quick BEFORE writing any code. This is mandatory.",
      "The title must be changelog-ready: start with a verb, complete sentence.",
      "Use label to control CHANGELOG categorization: bug, feature, security, etc.",
    ],
    parameters: ChainlinkQuickSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const client = getClient(ctx);
      if (!client) return { content: [{ type: "text" as const, text: "No .chainlink/ directory found." }] };
      const { title, priority, label } = params as ChainlinkQuickInput;
      const id = await client.quick(title, { priority, label });
      if (!id) return { content: [{ type: "text" as const, text: "Failed to create issue." }], isError: true };
      const parts = [`Created issue #${id}: \"${title}\"`];
      if (priority) parts.push(`Priority: ${priority}`);
      if (label) parts.push(`Label: ${label}`);
      parts.push("Now working on this issue.");
      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    },
  });
}
