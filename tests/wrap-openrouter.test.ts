import { describe, expect, it } from "vitest";
import { NazarClient } from "../src/client.js";
import { wrapOpenRouter } from "../src/middleware/openrouter.js";
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

/** Minimal fake OpenAI-compatible client, as used for OpenRouter. */
function makeFakeOpenRouter(createImpl: (...args: unknown[]) => unknown) {
  return {
    chat: {
      completions: {
        create: createImpl,
      },
    },
    apiKey: "sk-or-original-key",
  };
}

describe("wrapOpenRouter", () => {
  it("returns the exact same successful response, unmodified", async () => {
    const expectedResponse = {
      id: "gen-1",
      choices: [{ message: { role: "assistant", content: "hi there" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
    const fakeOpenRouter = makeFakeOpenRouter(async () => expectedResponse);
    const { client } = makeClient();
    const wrapped = wrapOpenRouter(client, fakeOpenRouter);

    const result = await wrapped.chat.completions.create({
      model: "anthropic/claude-sonnet-5",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result).toBe(expectedResponse);
  });

  it("propagates rejections unmodified (does not swallow errors)", async () => {
    const originalError = new Error("rate limit exceeded");
    const fakeOpenRouter = makeFakeOpenRouter(async () => {
      throw originalError;
    });
    const { client } = makeClient();
    const wrapped = wrapOpenRouter(client, fakeOpenRouter);

    await expect(
      wrapped.chat.completions.create({
        model: "anthropic/claude-sonnet-5",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toBe(originalError);
  });

  it("records a success event tagged with the openrouter provider and vendor/model slug", async () => {
    const fakeOpenRouter = makeFakeOpenRouter(async () => ({
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }));
    const { client, transport } = makeClient();
    const wrapped = wrapOpenRouter(client, fakeOpenRouter);

    await wrapped.chat.completions.create({
      model: "anthropic/claude-sonnet-5",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(transport.events).toHaveLength(1);
    const event = transport.events[0]!;
    expect(event.provider).toBe("openrouter");
    expect(event.model).toBe("anthropic/claude-sonnet-5");
    expect(event.status).toBe("success");
    expect(event.inputTokens).toBe(100);
    expect(event.outputTokens).toBe(50);
    // No static OpenRouter pricing table — cost estimate stays undefined.
    expect(event.cost).toBeUndefined();
  });

  it("leaves non-instrumented properties fully functional", () => {
    const fakeOpenRouter = makeFakeOpenRouter(async () => ({}));
    const { client } = makeClient();
    const wrapped = wrapOpenRouter(client, fakeOpenRouter);

    expect(wrapped.apiKey).toBe("sk-or-original-key");
  });

  it("does not record anything when the client is disabled", async () => {
    const fakeOpenRouter = makeFakeOpenRouter(async () => ({
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const { client, transport } = makeClient({ enabled: false });
    const wrapped = wrapOpenRouter(client, fakeOpenRouter);

    await wrapped.chat.completions.create({
      model: "openai/gpt-4o",
      messages: [],
    });
    expect(transport.events).toHaveLength(0);
  });
});
