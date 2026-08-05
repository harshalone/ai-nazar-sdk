import { describe, expect, it, vi } from "vitest";
import { NazarClient } from "../src/client.js";
import { wrapGemini } from "../src/middleware/gemini.js";
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

/** Minimal fake `@google/genai` client shaped like the real SDK. */
function makeFakeGemini(
  generateContentImpl: (...args: unknown[]) => unknown,
  generateContentStreamImpl?: (...args: unknown[]) => unknown,
) {
  return {
    models: {
      generateContent: generateContentImpl,
      generateContentStream:
        generateContentStreamImpl ?? vi.fn().mockResolvedValue({}),
      embedContent: vi.fn().mockResolvedValue({ data: "embedding-result" }),
    },
    apiKey: "gemini-original-key",
  };
}

describe("wrapGemini", () => {
  it("returns the exact same successful response, unmodified", async () => {
    const expectedResponse = {
      candidates: [{ content: { parts: [{ text: "hi there" }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    };
    const fakeGemini = makeFakeGemini(async () => expectedResponse);
    const { client } = makeClient();
    const wrapped = wrapGemini(client, fakeGemini);

    const result = await wrapped.models.generateContent({
      model: "gemini-2.0-flash",
      contents: "hello",
    });

    expect(result).toBe(expectedResponse);
  });

  it("propagates rejections unmodified (does not swallow errors)", async () => {
    const originalError = new Error("resource exhausted");
    const fakeGemini = makeFakeGemini(async () => {
      throw originalError;
    });
    const { client } = makeClient();
    const wrapped = wrapGemini(client, fakeGemini);

    await expect(
      wrapped.models.generateContent({
        model: "gemini-2.0-flash",
        contents: "hello",
      }),
    ).rejects.toBe(originalError);
  });

  it("propagates synchronous throws unmodified", () => {
    const originalError = new Error("sync boom");
    const fakeGemini = makeFakeGemini(() => {
      throw originalError;
    });
    const { client } = makeClient();
    const wrapped = wrapGemini(client, fakeGemini);

    expect(() =>
      wrapped.models.generateContent({
        model: "gemini-2.0-flash",
        contents: "hello",
      }),
    ).toThrow(originalError);
  });

  it("does not mutate the arguments passed to the original method", async () => {
    let receivedArgs: unknown;
    const fakeGemini = makeFakeGemini(async (...args: unknown[]) => {
      receivedArgs = args[0];
      return {
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      };
    });
    const { client } = makeClient();
    const wrapped = wrapGemini(client, fakeGemini);

    const originalRequest = { model: "gemini-2.0-flash", contents: "hello" };
    await wrapped.models.generateContent(originalRequest);

    expect(receivedArgs).toEqual(originalRequest);
  });

  it("records a success event with tokens, latency, and estimated cost", async () => {
    const fakeGemini = makeFakeGemini(async () => ({
      usageMetadata: {
        promptTokenCount: 1_000_000,
        candidatesTokenCount: 1_000_000,
      },
    }));
    const { client, transport } = makeClient();
    const wrapped = wrapGemini(client, fakeGemini);

    await wrapped.models.generateContent({
      model: "gemini-2.0-flash",
      contents: "hello",
    });

    expect(transport.events).toHaveLength(1);
    const event = transport.events[0]!;
    expect(event.provider).toBe("gemini");
    expect(event.model).toBe("gemini-2.0-flash");
    expect(event.status).toBe("success");
    expect(event.inputTokens).toBe(1_000_000);
    expect(event.outputTokens).toBe(1_000_000);
    expect(event.cost).toBeCloseTo(0.1 + 0.4, 5);
    expect(typeof event.latency).toBe("number");
  });

  it("records an error event on rejection, without prompt capture by default", async () => {
    const fakeGemini = makeFakeGemini(async () => {
      const err = new Error("bad request") as Error & { status?: number };
      err.status = 400;
      throw err;
    });
    const { client, transport } = makeClient();
    const wrapped = wrapGemini(client, fakeGemini);

    await expect(
      wrapped.models.generateContent({
        model: "gemini-2.0-flash",
        contents: "hello",
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
    const fakeGemini = makeFakeGemini(async () => ({
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    }));
    const { client, transport } = makeClient({
      capturePrompts: true,
      redactSensitiveData: false,
    });
    const wrapped = wrapGemini(client, fakeGemini);

    await wrapped.models.generateContent({
      model: "gemini-2.0-flash",
      contents: "hello",
    });

    expect(transport.events[0]?.prompt).toEqual("hello");
  });

  it("records the streaming call without failing, without an error status", async () => {
    const streamResult = (async function* () {
      yield { candidates: [] };
    })();
    const fakeGemini = makeFakeGemini(
      async () => ({}),
      async () => streamResult,
    );
    const { client, transport } = makeClient();
    const wrapped = wrapGemini(client, fakeGemini);

    const result = await wrapped.models.generateContentStream({
      model: "gemini-2.0-flash",
      contents: "hello",
    });

    expect(result).toBe(streamResult);
    expect(transport.events).toHaveLength(1);
    expect(transport.events[0]?.status).toBe("success");
  });

  it("leaves non-instrumented methods fully functional", async () => {
    const fakeGemini = makeFakeGemini(async () => ({}));
    const { client } = makeClient();
    const wrapped = wrapGemini(client, fakeGemini);

    const result = await wrapped.models.embedContent();
    expect(result).toEqual({ data: "embedding-result" });
  });

  it("preserves plain property access (non-function values)", () => {
    const fakeGemini = makeFakeGemini(async () => ({}));
    const { client } = makeClient();
    const wrapped = wrapGemini(client, fakeGemini);

    expect(wrapped.apiKey).toBe("gemini-original-key");
  });

  it("does not record anything when the client is disabled", async () => {
    const fakeGemini = makeFakeGemini(async () => ({
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    }));
    const { client, transport } = makeClient({ enabled: false });
    const wrapped = wrapGemini(client, fakeGemini);

    await wrapped.models.generateContent({
      model: "gemini-2.0-flash",
      contents: "hello",
    });
    expect(transport.events).toHaveLength(0);
  });
});
