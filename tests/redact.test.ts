import { describe, expect, it, vi } from "vitest";
import { applyRedaction, redactValue } from "../src/utils/redact.js";

describe("redactValue", () => {
  it("redacts email addresses in strings", () => {
    expect(redactValue("contact me at jane@example.com")).toBe(
      "contact me at [REDACTED]",
    );
  });

  it("redacts OpenAI-style API keys", () => {
    const result = redactValue("key is sk-abc123def456ghi789") as string;
    expect(result).not.toContain("sk-abc123def456ghi789");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts AI Nazar API keys", () => {
    const result = redactValue("nz_live_1234567890abcd") as string;
    expect(result).toBe("[REDACTED]");
  });

  it("redacts values under sensitive key names in objects", () => {
    const result = redactValue({
      username: "jane",
      password: "hunter2",
      apiKey: "sk-abc123def456ghi789",
    }) as Record<string, unknown>;

    expect(result.username).toBe("jane");
    expect(result.password).toBe("[REDACTED]");
    expect(result.apiKey).toBe("[REDACTED]");
  });

  it("recurses into nested arrays and objects", () => {
    const result = redactValue({
      messages: [{ role: "user", content: "email me: a@b.com" }],
    }) as { messages: Array<{ content: string }> };

    expect(result.messages[0]?.content).toBe("email me: [REDACTED]");
  });

  it("leaves non-sensitive values untouched", () => {
    expect(redactValue({ count: 5, active: true })).toEqual({
      count: 5,
      active: true,
    });
  });

  it("does not crash on cyclic-depth pathological input", () => {
    let deep: unknown = "leaf";
    for (let i = 0; i < 30; i++) {
      deep = { nested: deep };
    }
    expect(() => redactValue(deep)).not.toThrow();
  });
});

describe("applyRedaction", () => {
  const log = vi.fn();

  it("applies built-in redaction when redactSensitiveData is true", () => {
    const result = applyRedaction("email a@b.com", {
      redactSensitiveData: true,
      log,
    });
    expect(result).toBe("email [REDACTED]");
  });

  it("skips built-in redaction when disabled", () => {
    const result = applyRedaction("email a@b.com", {
      redactSensitiveData: false,
      log,
    });
    expect(result).toBe("email a@b.com");
  });

  it("applies a custom redact function on top of built-in redaction", () => {
    const result = applyRedaction("secret-value", {
      redactSensitiveData: false,
      redact: (v) => (typeof v === "string" ? v.toUpperCase() : v),
      log,
    });
    expect(result).toBe("SECRET-VALUE");
  });

  it("falls back to [REDACTED] and logs when custom redact throws", () => {
    const badRedact = vi.fn(() => {
      throw new Error("boom");
    });
    const result = applyRedaction("value", {
      redactSensitiveData: false,
      redact: badRedact,
      log,
    });
    expect(result).toBe("[REDACTED]");
    expect(log).toHaveBeenCalled();
  });
});
