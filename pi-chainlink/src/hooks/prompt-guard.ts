/**
 * Prompt-guard hook — tracks prompts since last chainlink usage and reminds.
 * Counter is in-memory only (resets on process restart). Acceptable since
 * pi sessions don't survive restarts.
 */

let promptsSinceChainlink = 0;
const REMINDER_THRESHOLD = 5;

/**
 * Reset the prompt counter (called when agent uses a chainlink command).
 */
export function resetPromptCounter(): void {
  promptsSinceChainlink = 0;
}

/**
 * Increment the prompt counter and return a reminder message if threshold reached.
 * Returns null if no reminder needed.
 */
export function checkPromptGuard(): string | null {
  promptsSinceChainlink++;

  if (promptsSinceChainlink >= REMINDER_THRESHOLD) {
    const msg =
      `Chainlink reminder: ${promptsSinceChainlink} prompts since last chainlink usage. ` +
      `Consider updating your issue: chainlink comment <id> "progress update"`;
    promptsSinceChainlink = 0; // Reset after reminding
    return msg;
  }

  return null;
}
