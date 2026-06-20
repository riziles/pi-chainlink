/**
 * Prompt-guard hook tests — verify counter reset and reminder logic.
 */

import { describe, it, expect } from "vitest";

import { checkPromptGuard, resetPromptCounter } from "../../src/hooks/prompt-guard.js";

describe("prompt-guard", () => {
  it("returns null before threshold", () => {
    resetPromptCounter();
    for (let i = 0; i < 4; i++) {
      expect(checkPromptGuard()).toBeNull();
    }
  });

  it("returns reminder at threshold (5 prompts)", () => {
    resetPromptCounter();
    for (let i = 0; i < 4; i++) {
      checkPromptGuard();
    }
    const reminder = checkPromptGuard();
    expect(reminder).not.toBeNull();
    expect(reminder).toContain("chainlink");
  });

  it("resets counter after reminder triggers", () => {
    resetPromptCounter();
    for (let i = 0; i < 5; i++) {
      checkPromptGuard(); // 5th triggers reminder, resets
    }
    // Counter should be 0 now — next 4 should be null
    for (let i = 0; i < 4; i++) {
      expect(checkPromptGuard()).toBeNull();
    }
  });

  it("resetPromptCounter prevents reminder", () => {
    resetPromptCounter();
    for (let i = 0; i < 4; i++) {
      checkPromptGuard();
    }
    // Reset before hitting threshold
    resetPromptCounter();
    for (let i = 0; i < 4; i++) {
      expect(checkPromptGuard()).toBeNull();
    }
  });

  it("counter continues after reset (full cycle)", () => {
    resetPromptCounter();
    // 2 prompts, then reset (simulates chainlink tool usage)
    checkPromptGuard();
    checkPromptGuard();
    resetPromptCounter();
    // After reset, need 5 new prompts to trigger
    for (let i = 0; i < 4; i++) {
      expect(checkPromptGuard()).toBeNull();
    }
    expect(checkPromptGuard()).not.toBeNull();
  });
});
