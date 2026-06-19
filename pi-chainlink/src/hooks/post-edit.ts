/**
 * Post-edit hook — detects stubs (TODO, FIXME, unimplemented!) in written/edited files.
 * Debounced: only runs once per file per 60 seconds.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

// ── Stub detection ──────────────────────────────────────────────────────

const STUB_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  // Bare TODO (not TODO(username):)
  { regex: /\/\/\s*TODO(?!\s*\([^)]+\):)/gi, label: "TODO" },
  { regex: /#\s*TODO(?!\s*\([^)]+\):)/gi, label: "TODO" },
  // FIXME
  { regex: /\bFIXME\b/gi, label: "FIXME" },
  // HACK
  { regex: /\bHACK\b/gi, label: "HACK" },
  // Rust unimplemented!()
  { regex: /unimplemented!\s*\(/g, label: "unimplemented!()" },
  // Python pass in empty functions (rough detection)
  { regex: /:\s*\n\s+pass\s*\n/g, label: "pass" },
  // Standalone ... (placeholder)
  { regex: /^\s*\.\.\.\s*$/gm, label: "..." },
  // NotImplementedError
  { regex: /throw new Error\s*\(\s*["']Not implemented["']/g, label: "NotImplementedError" },
  { regex: /raise NotImplementedError/g, label: "NotImplementedError" },
];

/**
 * Scan file content for stubs. Returns list of detected stub types.
 */
export function detectStubs(content: string): string[] {
  const found = new Set<string>();

  for (const pattern of STUB_PATTERNS) {
    if (pattern.regex.test(content)) {
      found.add(pattern.label);
    }
  }

  return [...found];
}

// ── Debouncing ──────────────────────────────────────────────────────────

const lastCheck: Map<string, number> = new Map();
const DEBOUNCE_MS = 60_000; // 60 seconds

/**
 * Check a file for stubs, with debouncing.
 * Returns the list of detected stubs, or empty if skipped.
 */
export async function checkFileForStubs(filePath: string): Promise<string[]> {
  const now = Date.now();
  const last = lastCheck.get(filePath);

  if (last && now - last < DEBOUNCE_MS) {
    return []; // Debounced
  }

  lastCheck.set(filePath, now);

  try {
    const content = await readFile(filePath, "utf-8");
    return detectStubs(content);
  } catch {
    return []; // File may not exist yet, or not readable
  }
}

/**
 * Build a friendly notification message for detected stubs.
 */
export function buildStubMessage(filePath: string, stubs: string[]): string {
  const fileName = basename(filePath);
  return (
    `Stubs detected in ${fileName}: ${stubs.join(", ")}. ` +
    "Implement complete code, not placeholders."
  );
}
