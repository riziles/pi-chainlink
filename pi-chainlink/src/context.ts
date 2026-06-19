/**
 * Context builder — generates chainlink session context for injection.
 * Reads rule files from .chainlink/rules/ and session state from CLI.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import type { ChainlinkClient } from "./client.js";

// ── Language detection ──────────────────────────────────────────────────

const LANGUAGE_RULE_FILES: Record<string, string[]> = {
  typescript: ["typescript-react.md", "typescript.md"],
  javascript: ["javascript-react.md", "javascript.md"],
  python: ["python.md"],
  rust: ["rust.md"],
  go: ["go.md"],
  java: ["java.md"],
  kotlin: ["kotlin.md"],
  swift: ["swift.md"],
  c: ["c.md"],
  cpp: ["cpp.md"],
  csharp: ["csharp.md"],
  ruby: ["ruby.md"],
  php: ["php.md"],
  scala: ["scala.md"],
  elixir: ["elixir-phoenix.md", "elixir.md"],
  zig: ["zig.md"],
  odin: ["odin.md"],
};

/**
 * Detect project languages by scanning for common config files.
 * Returns language keys matching LANGUAGE_RULE_FILES.
 */
function detectLanguages(projectDir: string): string[] {
  const languages: string[] = [];

  const detectors: [string, string][] = [
    ["tsconfig.json", "typescript"],
    ["package.json", "javascript"], // Will also match if TS not found
    ["pyproject.toml", "python"],
    ["requirements.txt", "python"],
    ["Cargo.toml", "rust"],
    ["go.mod", "go"],
    ["pom.xml", "java"],
    ["build.gradle", "java"],
    ["build.gradle.kts", "kotlin"],
    ["CMakeLists.txt", "cpp"],
    ["Makefile", "c"], // Weak signal, only if .c files exist
    ["Gemfile", "ruby"],
    ["composer.json", "php"],
    ["mix.exs", "elixir"],
    ["build.zig", "zig"],
  ];

  // TypeScript overrides JavaScript if both found
  const hasTsConfig = existsSync(join(projectDir, "tsconfig.json"));
  const hasPackageJson = existsSync(join(projectDir, "package.json"));

  if (hasTsConfig) {
    languages.push("typescript");
  } else if (hasPackageJson) {
    languages.push("javascript");
  }

  for (const [file, lang] of detectors) {
    if (existsSync(join(projectDir, file)) && !languages.includes(lang)) {
      languages.push(lang);
    }
  }

  // Deduplicate
  return [...new Set(languages)];
}

// ── Rule loading ────────────────────────────────────────────────────────

/**
 * Read rule file content from .chainlink/rules/.
 */
function readRuleFile(chainlinkDir: string, filename: string): string | null {
  const path = join(chainlinkDir, ".chainlink", "rules", filename);
  try {
    return readFileSync(path, "utf-8").trim();
  } catch {
    return null;
  }
}

/**
 * Build the coding rules section from rule files.
 */
function getRuleContent(chainlinkDir: string, trackingMode: string): string {
  const rulesDir = join(chainlinkDir, ".chainlink", "rules");
  const sections: string[] = [];

  // Global rules (always)
  const global = readRuleFile(chainlinkDir, "global.md");
  if (global) {
    sections.push("## Coding Rules\n");
    sections.push("### General Requirements");
    sections.push(global);
  }

  // Language-specific rules
  const languages = detectLanguages(chainlinkDir);
  for (const lang of languages) {
    const ruleFiles = LANGUAGE_RULE_FILES[lang] || [];
    for (const file of ruleFiles) {
      const content = readRuleFile(chainlinkDir, file);
      if (content) {
        const langName = basename(file, ".md")
          .replace(/-react$/, " (React)")
          .replace(/-phoenix$/, " (Phoenix)")
          .replace(/^./, (c) => c.toUpperCase());
        sections.push(`\n### ${langName}`);
        sections.push(content);
        break; // Only first matching file per language
      }
    }
  }

  // Quality/rigor rules
  const quality = readRuleFile(chainlinkDir, "quality.md");
  if (quality) {
    sections.push("\n### Quality Standards");
    sections.push(quality);
  }

  const rigor = readRuleFile(chainlinkDir, "rigor.md");
  if (rigor) {
    sections.push("\n### Rigor Requirements");
    sections.push(rigor);
  }

  // Tracking mode rules
  const trackingRule = readRuleFile(chainlinkDir, `tracking-${trackingMode}.md`);
  if (trackingRule) {
    sections.push("\n### Workflow Tracking");
    sections.push(trackingRule);
  }

  return sections.join("\n");
}

// ── Context assembly ────────────────────────────────────────────────────

/**
 * Build the full chainlink context block for injection into pi.
 * Combines session state, issue lists, rules, and workflow reminders.
 */
export async function buildContext(
  chainlinkDir: string,
  client: ChainlinkClient,
  config: { tracking_mode: string },
): Promise<string> {
  const lines: string[] = [];
  lines.push("<chainlink-session-context>");

  // Session state
  const status = await client.sessionStatus();
  if (status) {
    lines.push("## Session");
    lines.push(`Session #${status.session_id} active (started ${status.started_at})`);
    if (status.active_issue) {
      lines.push(`Working on: #${status.active_issue.id} ${status.active_issue.title}`);
    }
    if (status.last_action) {
      lines.push(`Last action: ${status.last_action}`);
    }
    lines.push(`Duration: ${status.duration_minutes} minutes`);
    lines.push("");
  }

  // Previous handoff
  const handoff = await client.sessionLastHandoff();
  if (handoff) {
    lines.push("## Previous Session Handoff");
    lines.push(handoff);
    lines.push("");
  }

  // Ready issues
  const readyIssues = await client.ready();
  if (readyIssues.length > 0) {
    lines.push("## Ready Issues (unblocked)");
    for (const issue of readyIssues) {
      lines.push(`  #${issue.id}    ${issue.priority.padEnd(7)} ${issue.title}`);
    }
    lines.push("");
  }

  // Open issues
  const openIssues = (await client.list({ status: "open" })).filter(
    (i) => !readyIssues.some((r) => r.id === i.id),
  );
  if (openIssues.length > 0) {
    lines.push("## Open Issues");
    for (const issue of openIssues.slice(0, 10)) {
      // Cap at 10 to avoid token bloat
      lines.push(`  #${issue.id}    ${issue.priority.padEnd(7)} ${issue.title}`);
    }
    if (openIssues.length > 10) {
      lines.push(`  ... and ${openIssues.length - 10} more`);
    }
    lines.push("");
  }

  // Coding rules
  const rules = getRuleContent(chainlinkDir, config.tracking_mode);
  if (rules) {
    lines.push(rules);
    lines.push("");
  }

  // Workflow reminder
  lines.push("## Workflow");
  lines.push("- Use `chainlink session start` at the beginning of work");
  lines.push("- Use `chainlink session work <id>` to mark current focus");
  lines.push('- Add comments: `chainlink comment <id> "..."`');
  lines.push('- End with notes: `chainlink session end --notes "..."`');
  lines.push(`- Tracking mode: ${config.tracking_mode}`);
  lines.push("");

  lines.push("</chainlink-session-context>");

  return lines.join("\n");
}
