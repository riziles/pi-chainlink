/**
 * Session lifecycle handling — auto-start/end sessions, handle handoffs.
 */

import type { ChainlinkClient } from "../client.js";

const STALE_SESSION_HOURS = 4;

/**
 * Handle session lifecycle on extension load:
 * - End stale sessions (>4 hours idle)
 * - Auto-start session if none active
 * - Show previous handoff on resume
 */
export async function handleSessionLifecycle(client: ChainlinkClient): Promise<void> {
  const status = await client.sessionStatus();

  if (status && status.session_id > 0) {
    // Check if session is stale
    const startedAt = new Date(status.started_at).getTime();
    const now = Date.now();
    const hoursSinceStart = (now - startedAt) / (1000 * 60 * 60);

    if (hoursSinceStart > STALE_SESSION_HOURS) {
      // Auto-end stale session
      await client.sessionEnd(
        `[auto] Session auto-ended — idle for ${Math.round(hoursSinceStart)} hours`,
      );
      // Start a new one
      await client.sessionStart();
    }
    // Otherwise, session is active — let it continue
  } else {
    // No active session — start one
    await client.sessionStart();
  }
}
