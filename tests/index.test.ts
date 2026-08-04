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
});
