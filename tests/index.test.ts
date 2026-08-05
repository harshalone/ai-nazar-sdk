import { afterEach, describe, expect, it } from "vitest";
import { Nazar } from "../src/index.js";
import { MemoryTransport } from "./helpers/memory-transport.js";

describe("Nazar (static entry point)", () => {
  afterEach(() => {
    Nazar._resetForTests();
  });

  it("init() returns a usable client", () => {
    const client = Nazar.init({
      apiKey: "nz_live_x",
      transport: new MemoryTransport(),
    });
    expect(client).toBeDefined();
    expect(typeof client.track).toBe("function");
  });

  it("getClient() returns the most recently initialized client", () => {
    const client = Nazar.init({
      apiKey: "nz_live_x",
      transport: new MemoryTransport(),
    });
    expect(Nazar.getClient()).toBe(client);
  });

  it("getClient() throws a helpful error before init()", () => {
    expect(() => Nazar.getClient()).toThrow(/Nazar\.init/);
  });

  it("wrapOpenAI() uses the singleton client when none is passed explicitly", async () => {
    const transport = new MemoryTransport();
    Nazar.init({ apiKey: "nz_live_x", transport, flushInterval: 0 });

    const fakeOpenAI = {
      chat: {
        completions: {
          create: async (..._args: unknown[]) => ({
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
        },
      },
    };

    const wrapped = Nazar.wrapOpenAI(fakeOpenAI);
    await wrapped.chat.completions.create({ model: "gpt-4o", messages: [] });

    expect(transport.events).toHaveLength(1);
  });

  it("wrapOpenRouter() uses the singleton client when none is passed explicitly", async () => {
    const transport = new MemoryTransport();
    Nazar.init({ apiKey: "nz_live_x", transport, flushInterval: 0 });

    const fakeOpenRouter = {
      chat: {
        completions: {
          create: async (..._args: unknown[]) => ({
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
        },
      },
    };

    const wrapped = Nazar.wrapOpenRouter(fakeOpenRouter);
    await wrapped.chat.completions.create({
      model: "anthropic/claude-sonnet-5",
      messages: [],
    });

    expect(transport.events).toHaveLength(1);
    expect(transport.events[0]?.provider).toBe("openrouter");
  });

  it("wrapAnthropic() uses the singleton client when none is passed explicitly", async () => {
    const transport = new MemoryTransport();
    Nazar.init({ apiKey: "nz_live_x", transport, flushInterval: 0 });

    const fakeAnthropic = {
      messages: {
        create: async (..._args: unknown[]) => ({
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      },
    };

    const wrapped = Nazar.wrapAnthropic(fakeAnthropic);
    await wrapped.messages.create({ model: "claude-sonnet-5", messages: [] });

    expect(transport.events).toHaveLength(1);
    expect(transport.events[0]?.provider).toBe("anthropic");
  });

  it("wrapGemini() uses the singleton client when none is passed explicitly", async () => {
    const transport = new MemoryTransport();
    Nazar.init({ apiKey: "nz_live_x", transport, flushInterval: 0 });

    const fakeGemini = {
      models: {
        generateContent: async (..._args: unknown[]) => ({
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        }),
      },
    };

    const wrapped = Nazar.wrapGemini(fakeGemini);
    await wrapped.models.generateContent({
      model: "gemini-2.0-flash",
      contents: "hi",
    });

    expect(transport.events).toHaveLength(1);
    expect(transport.events[0]?.provider).toBe("gemini");
  });
});
