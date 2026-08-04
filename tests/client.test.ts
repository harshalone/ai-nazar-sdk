import { describe, expect, it, vi } from "vitest";
import { NazarClient } from "../src/client.js";
import { MemoryTransport } from "./helpers/memory-transport.js";

function makeClient(overrides: Record<string, unknown> = {}) {
  const transport = new MemoryTransport();
  const client = new NazarClient({
    apiKey: "nz_live_test",
    transport,
    flushInterval: 0,
    ...overrides,
  });
  return { client, transport };
}

describe("NazarClient.track", () => {
  it("queues a well-formed event via the transport", () => {
    const { client, transport } = makeClient();

    client.track({
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 100,
      outputTokens: 50,
      latency: 200,
      cost: 0.01,
    });

    expect(transport.events).toHaveLength(1);
    const event = transport.events[0]!;
    expect(event.provider).toBe("openai");
    expect(event.model).toBe("gpt-4o");
    expect(event.status).toBe("success");
    expect(event.id).toBeTruthy();
    expect(event.timestamp).toBeTypeOf("number");
    expect(event.sdk?.name).toBe("ai-nazar");
  });

  it("defaults status to success when not provided", () => {
    const { client, transport } = makeClient();
    client.track({ provider: "openai", model: "gpt-4o" });
    expect(transport.events[0]?.status).toBe("success");
  });

  it("preserves an explicit status and error", () => {
    const { client, transport } = makeClient();
    client.track({
      provider: "openai",
      model: "gpt-4o",
      status: "error",
      error: { message: "boom" },
    });
    expect(transport.events[0]?.status).toBe("error");
    expect(transport.events[0]?.error?.message).toBe("boom");
  });

  it("silently ignores calls missing required fields", () => {
    const { client, transport } = makeClient();
    // @ts-expect-error intentionally invalid input
    client.track({ provider: "openai" });
    // @ts-expect-error intentionally invalid input
    client.track({});
    expect(transport.events).toHaveLength(0);
  });

  it("never throws even with garbage input", () => {
    const { client } = makeClient();
    // @ts-expect-error intentionally invalid input
    expect(() => client.track(null)).not.toThrow();
    // @ts-expect-error intentionally invalid input
    expect(() => client.track("nonsense")).not.toThrow();
  });

  it("does not track anything when the SDK is disabled", () => {
    const { client, transport } = makeClient({ enabled: false });
    client.track({ provider: "openai", model: "gpt-4o" });
    expect(transport.events).toHaveLength(0);
  });

  it("omits prompt/response by default (privacy-first)", () => {
    const { client, transport } = makeClient();
    client.track({
      provider: "openai",
      model: "gpt-4o",
      prompt: "hello",
      response: "world",
    });
    expect(transport.events[0]?.prompt).toBeUndefined();
    expect(transport.events[0]?.response).toBeUndefined();
  });

  it("captures prompt/response when explicitly enabled", () => {
    const { client, transport } = makeClient({
      capturePrompts: true,
      captureResponses: true,
      redactSensitiveData: false,
    });
    client.track({
      provider: "openai",
      model: "gpt-4o",
      prompt: "hello",
      response: "world",
    });
    expect(transport.events[0]?.prompt).toBe("hello");
    expect(transport.events[0]?.response).toBe("world");
  });

  it("redacts captured prompt content by default when capture is enabled", () => {
    const { client, transport } = makeClient({ capturePrompts: true });
    client.track({
      provider: "openai",
      model: "gpt-4o",
      prompt: "my email is a@b.com",
    });
    expect(transport.events[0]?.prompt).toBe("my email is [REDACTED]");
  });

  it("redacts metadata by default", () => {
    const { client, transport } = makeClient();
    client.track({
      provider: "openai",
      model: "gpt-4o",
      metadata: { apiKey: "sk-abc123def456ghi789" },
    });
    expect(transport.events[0]?.metadata?.apiKey).toBe("[REDACTED]");
  });
});

describe("NazarClient.captureException", () => {
  it("normalizes an Error instance", () => {
    const { client, transport } = makeClient();
    client.captureException(new Error("rate limited"), {
      provider: "openai",
      model: "gpt-4o",
    });
    const event = transport.events[0]!;
    expect(event.status).toBe("error");
    expect(event.error?.message).toBe("rate limited");
    expect(event.error?.stack).toBeTruthy();
  });

  it("normalizes a string error", () => {
    const { client, transport } = makeClient();
    client.captureException("plain string error");
    expect(transport.events[0]?.error?.message).toBe("plain string error");
  });

  it("falls back to unknown provider/model when not given", () => {
    const { client, transport } = makeClient();
    client.captureException(new Error("x"));
    expect(transport.events[0]?.provider).toBe("unknown");
    expect(transport.events[0]?.model).toBe("unknown");
  });

  it("never throws", () => {
    const { client } = makeClient();
    expect(() => client.captureException(null)).not.toThrow();
    expect(() => client.captureException(undefined)).not.toThrow();
  });
});

describe("NazarClient.flush / shutdown", () => {
  it("delegates to the transport and swallows errors", async () => {
    const transport = new MemoryTransport();
    transport.flush = vi.fn().mockRejectedValue(new Error("boom"));
    const client = new NazarClient({ apiKey: "nz_live_test", transport });

    await expect(client.flush()).resolves.toBeUndefined();
  });

  it("shutdown calls transport.shutdown", async () => {
    const { client, transport } = makeClient();
    await client.shutdown();
    expect(transport.shutdownCalled).toBe(true);
  });
});
