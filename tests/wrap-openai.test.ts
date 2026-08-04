import { describe, expect, it, vi } from "vitest";
import { NazarClient } from "../src/client.js";
import { wrapOpenAI } from "../src/middleware/openai.js";
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

/** Minimal fake OpenAI client shaped like the real SDK. */
function makeFakeOpenAI(createImpl: (...args: unknown[]) => unknown) {
  return {
    chat: {
      completions: {
        create: createImpl,
      },
    },
    embeddings: {
      create: vi.fn().mockResolvedValue({ data: "embedding-result" }),
    },
    apiKey: "sk-original-key",
  };
}

describe("wrapOpenAI", () => {
  it("returns the exact same successful response, unmodified", async () => {
    const expectedResponse = {
      id: "chatcmpl-1",
      choices: [{ message: { role: "assistant", content: "hi there" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
    const fakeOpenAI = makeFakeOpenAI(async () => expectedResponse);
    const { client } = makeClient();
    const wrapped = wrapOpenAI(client, fakeOpenAI);

    const result = await wrapped.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result).toBe(expectedResponse);
  });

  it("propagates rejections unmodified (does not swallow errors)", async () => {
    const originalError = new Error("rate limit exceeded");
    const fakeOpenAI = makeFakeOpenAI(async () => {
      throw originalError;
    });
    const { client } = makeClient();
    const wrapped = wrapOpenAI(client, fakeOpenAI);

    await expect(
      wrapped.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toBe(originalError);
  });

  it("propagates synchronous throws unmodified", () => {
    const originalError = new Error("sync boom");
    const fakeOpenAI = makeFakeOpenAI(() => {
      throw originalError;
    });
    const { client } = makeClient();
    const wrapped = wrapOpenAI(client, fakeOpenAI);

    expect(() =>
      wrapped.chat.completions.create({ model: "gpt-4o", messages: [] }),
    ).toThrow(originalError);
  });

  it("does not mutate the arguments passed to the original method", async () => {
    let receivedArgs: unknown;
    const fakeOpenAI = makeFakeOpenAI(async (...args: unknown[]) => {
      receivedArgs = args[0];
      return { usage: { prompt_tokens: 1, completion_tokens: 1 } };
    });
    const { client } = makeClient();
    const wrapped = wrapOpenAI(client, fakeOpenAI);

    const originalRequest = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "hello" }],
    };
    await wrapped.chat.completions.create(originalRequest);

    expect(receivedArgs).toEqual(originalRequest);
  });

  it("records a success event with tokens, latency, and estimated cost", async () => {
    const fakeOpenAI = makeFakeOpenAI(async () => ({
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
    }));
    const { client, transport } = makeClient();
    const wrapped = wrapOpenAI(client, fakeOpenAI);

    await wrapped.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(transport.events).toHaveLength(1);
    const event = transport.events[0]!;
    expect(event.provider).toBe("openai");
    expect(event.model).toBe("gpt-4o-mini");
    expect(event.status).toBe("success");
    expect(event.inputTokens).toBe(1_000_000);
    expect(event.outputTokens).toBe(1_000_000);
    expect(event.cost).toBeCloseTo(0.15 + 0.6, 5);
    expect(typeof event.latency).toBe("number");
  });

  it("records an error event on rejection, without prompt capture by default", async () => {
    const fakeOpenAI = makeFakeOpenAI(async () => {
      const err = new Error("bad request") as Error & { status?: number };
      err.status = 400;
      throw err;
    });
    const { client, transport } = makeClient();
    const wrapped = wrapOpenAI(client, fakeOpenAI);

    await expect(
      wrapped.chat.completions.create({
        model: "gpt-4o",
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

  it("captures prompt content only when capturePrompts is enabled", async () => {
    const fakeOpenAI = makeFakeOpenAI(async () => ({
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const { client, transport } = makeClient({
      capturePrompts: true,
      redactSensitiveData: false,
    });
    const wrapped = wrapOpenAI(client, fakeOpenAI);

    const messages = [{ role: "user", content: "hello" }];
    await wrapped.chat.completions.create({ model: "gpt-4o", messages });

    expect(transport.events[0]?.prompt).toEqual(messages);
  });

  it("leaves non-instrumented methods fully functional", async () => {
    const fakeOpenAI = makeFakeOpenAI(async () => ({}));
    const { client } = makeClient();
    const wrapped = wrapOpenAI(client, fakeOpenAI);

    const result = await wrapped.embeddings.create();
    expect(result).toEqual({ data: "embedding-result" });
  });

  it("preserves plain property access (non-function values)", () => {
    const fakeOpenAI = makeFakeOpenAI(async () => ({}));
    const { client } = makeClient();
    const wrapped = wrapOpenAI(client, fakeOpenAI);

    expect(wrapped.apiKey).toBe("sk-original-key");
  });

  it("does not record anything when the client is disabled", async () => {
    const fakeOpenAI = makeFakeOpenAI(async () => ({
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const { client, transport } = makeClient({ enabled: false });
    const wrapped = wrapOpenAI(client, fakeOpenAI);

    await wrapped.chat.completions.create({ model: "gpt-4o", messages: [] });
    expect(transport.events).toHaveLength(0);
  });
});
