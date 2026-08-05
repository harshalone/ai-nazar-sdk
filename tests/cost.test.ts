import { describe, expect, it } from "vitest";
import { estimateCost } from "../src/utils/cost.js";

describe("estimateCost", () => {
  it("computes cost for a known model", () => {
    const cost = estimateCost("openai", "gpt-4o-mini", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.15 + 0.6, 5);
  });

  it("is case-insensitive on provider and model", () => {
    const cost = estimateCost("OpenAI", "GPT-4O-MINI", 1_000_000, 0);
    expect(cost).toBeCloseTo(0.15, 5);
  });

  it("returns undefined for unknown models rather than guessing", () => {
    const cost = estimateCost("openai", "some-future-model", 1000, 1000);
    expect(cost).toBeUndefined();
  });

  it("returns undefined for unknown providers", () => {
    const cost = estimateCost("mystery-provider", "gpt-4o", 1000, 1000);
    expect(cost).toBeUndefined();
  });

  it("handles zero tokens", () => {
    const cost = estimateCost("openai", "gpt-4o", 0, 0);
    expect(cost).toBe(0);
  });

  it("computes cost for a known Anthropic model", () => {
    const cost = estimateCost(
      "anthropic",
      "claude-sonnet-5",
      1_000_000,
      1_000_000,
    );
    expect(cost).toBeCloseTo(3 + 15, 5);
  });

  it("computes cost for a known Gemini model", () => {
    const cost = estimateCost(
      "gemini",
      "gemini-2.0-flash",
      1_000_000,
      1_000_000,
    );
    expect(cost).toBeCloseTo(0.1 + 0.4, 5);
  });

  it("returns undefined for openrouter (no static pricing table)", () => {
    const cost = estimateCost(
      "openrouter",
      "anthropic/claude-sonnet-5",
      1_000_000,
      1_000_000,
    );
    expect(cost).toBeUndefined();
  });
});
