import { describe, expect, it, vi } from "vitest";
import { NazarClient } from "../src/client.js";
import { wrapAnthropic } from "../src/middleware/anthropic.js";
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

/** Minimal fake Anthropic client shaped like the real SDK. */
function makeFakeAnthropic(createImpl: (...args: unknown[]) => unknown) {
  return {
    messages: {
      create: createImpl,
    },
    completions: {
      create: vi.fn().mockResolvedValue({ completion: "legacy-result" }),
    },
    apiKey: "sk-ant-original-key",
  };
}

describe("wrapAnthropic", () => {
  it("returns the exact same successful response, unmodified", async () => {
    const expectedResponse = {
      id: "msg_1",
      content: [{ type: "text", text: "hi there" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    const fakeAnthropic = makeFakeAnthropic(async () => expectedResponse);
    const { client } = makeClient();
    const wrapped = wrapAnthropic(client, fakeAnthropic);

    const result = await wrapped.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result).toBe(expectedResponse);
  });

  it("propagates rejections unmodified (does not swallow errors)", async () => {
    const originalError = new Error("overloaded_error");
    const fakeAnthropic = makeFakeAnthropic(async () => {
      throw originalError;
    });
    const { client } = makeClient();
    const wrapped = wrapAnthropic(client, fakeAnthropic);

    await expect(
      wrapped.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 1024,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toBe(originalError);
  });

  it("propagates synchronous throws unmodified", () => {
    const originalError = new Error("sync boom");
    const fakeAnthropic = makeFakeAnthropic(() => {
      throw originalError;
    });
    const { client } = makeClient();
    const wrapped = wrapAnthropic(client, fakeAnthropic);

    expect(() =>
      wrapped.messages.create({ model: "claude-sonnet-5", messages: [] }),
    ).toThrow(originalError);
  });

  it("does not mutate the arguments passed to the original method", async () => {
    let receivedArgs: unknown;
    const fakeAnthropic = makeFakeAnthropic(async (...args: unknown[]) => {
      receivedArgs = args[0];
      return { usage: { input_tokens: 1, output_tokens: 1 } };
    });
    const { client } = makeClient();
    const wrapped = wrapAnthropic(client, fakeAnthropic);

    const originalRequest = {
      model: "claude-sonnet-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: "hello" }],
    };
    await wrapped.messages.create(originalRequest);

    expect(receivedArgs).toEqual(originalRequest);
  });

  it("records a success event with tokens, latency, and estimated cost", async () => {
    const fakeAnthropic = makeFakeAnthropic(async () => ({
      usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
    }));
    const { client, transport } = makeClient();
    const wrapped = wrapAnthropic(client, fakeAnthropic);

    await wrapped.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(transport.events).toHaveLength(1);
    const event = transport.events[0]!;
    expect(event.provider).toBe("anthropic");
    expect(event.model).toBe("claude-sonnet-5");
    expect(event.status).toBe("success");
    expect(event.inputTokens).toBe(1_000_000);
    expect(event.outputTokens).toBe(1_000_000);
    expect(event.cost).toBeCloseTo(3 + 15, 5);
    expect(typeof event.latency).toBe("number");
  });

  it("records an error event on rejection, without prompt capture by default", async () => {
    const fakeAnthropic = makeFakeAnthropic(async () => {
      const err = new Error("bad request") as Error & { status?: number };
      err.status = 400;
      throw err;
    });
    const { client, transport } = makeClient();
    const wrapped = wrapAnthropic(client, fakeAnthropic);

    await expect(
      wrapped.messages.create({
        model: "claude-sonnet-5",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow("bad request");

    expect(transport.events).toHaveLength(1);
    const event = transport.events[0]!;
    expect(event.status).toBe("error");
    expect(event.error?.message).toBe("bad request");
    expect(event.error?.statusCode).toBe(400);
    expect(event.prompt).toBeUndefined();
  });

  it("captures prompt content (including system) only when capturePrompts is enabled", async () => {
    const fakeAnthropic = makeFakeAnthropic(async () => ({
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const { client, transport } = makeClient({
      capturePrompts: true,
      redactSensitiveData: false,
    });
    const wrapped = wrapAnthropic(client, fakeAnthropic);

    const messages = [{ role: "user", content: "hello" }];
    await wrapped.messages.create({
      model: "claude-sonnet-5",
      system: "be nice",
      messages,
    });

    expect(transport.events[0]?.prompt).toEqual({
      system: "be nice",
      messages,
    });
  });

  it("leaves non-instrumented methods fully functional", async () => {
    const fakeAnthropic = makeFakeAnthropic(async () => ({}));
    const { client } = makeClient();
    const wrapped = wrapAnthropic(client, fakeAnthropic);

    const result = await wrapped.completions.create();
    expect(result).toEqual({ completion: "legacy-result" });
  });

  it("preserves plain property access (non-function values)", () => {
    const fakeAnthropic = makeFakeAnthropic(async () => ({}));
    const { client } = makeClient();
    const wrapped = wrapAnthropic(client, fakeAnthropic);

    expect(wrapped.apiKey).toBe("sk-ant-original-key");
  });

  it("does not record anything when the client is disabled", async () => {
    const fakeAnthropic = makeFakeAnthropic(async () => ({
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const { client, transport } = makeClient({ enabled: false });
    const wrapped = wrapAnthropic(client, fakeAnthropic);

    await wrapped.messages.create({ model: "claude-sonnet-5", messages: [] });
    expect(transport.events).toHaveLength(0);
  });
});
