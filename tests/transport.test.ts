import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpTransport } from "../src/transport.js";
import { resolveConfig } from "../src/config.js";
import { Logger } from "../src/utils/logger.js";
import type { AIRequestEvent } from "../src/types.js";

function makeEvent(overrides: Partial<AIRequestEvent> = {}): AIRequestEvent {
  return {
    id: "evt_1",
    provider: "openai",
    model: "gpt-4o",
    status: "success",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("HttpTransport", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not send anything until batchSize is reached or flush() is called", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    const config = resolveConfig({
      apiKey: "nz_live_x",
      batchSize: 5,
      flushInterval: 0,
    });
    const transport = new HttpTransport(config, new Logger(false));

    transport.send([makeEvent()]);
    // Give any accidental async send a chance to run.
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();

    await transport.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await transport.shutdown();
  });

  it("automatically flushes once batchSize is reached", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    const config = resolveConfig({
      apiKey: "nz_live_x",
      batchSize: 2,
      flushInterval: 0,
    });
    const transport = new HttpTransport(config, new Logger(false));

    transport.send([makeEvent(), makeEvent()]);
    await transport.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.events).toHaveLength(2);
    await transport.shutdown();
  });

  it("sends the API key as a bearer token and correct content type", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    const config = resolveConfig({
      apiKey: "nz_live_secret",
      flushInterval: 0,
    });
    const transport = new HttpTransport(config, new Logger(false));

    transport.send([makeEvent()]);
    await transport.flush();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://www.ainazar.com/api/v1/events");
    expect(init.headers.authorization).toBe("Bearer nz_live_secret");
    expect(init.headers["content-type"]).toBe("application/json");
    await transport.shutdown();
  });

  it("retries failed deliveries up to maxRetries, then gives up and calls onError", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const onError = vi.fn();
    const config = resolveConfig({
      apiKey: "nz_live_x",
      flushInterval: 0,
      maxRetries: 2,
      retryBaseDelay: 1,
      onError,
    });
    const transport = new HttpTransport(config, new Logger(false));

    transport.send([makeEvent()]);
    await transport.flush();

    // 1 initial attempt + 2 retries = 3 calls
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(3);
    expect(onError.mock.calls[2][0].willRetry).toBe(false);
    await transport.shutdown();
  });

  it("recovers once the network comes back (simulated offline -> online)", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" });

    const config = resolveConfig({
      apiKey: "nz_live_x",
      flushInterval: 0,
      maxRetries: 3,
      retryBaseDelay: 1,
    });
    const transport = new HttpTransport(config, new Logger(false));

    transport.send([makeEvent()]);
    await transport.flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    await transport.shutdown();
  });

  it("drops oldest events when maxQueueSize is exceeded", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    const config = resolveConfig({
      apiKey: "nz_live_x",
      maxQueueSize: 3,
      batchSize: 100, // prevent auto-flush so we can inspect the queue
      flushInterval: 0,
    });
    const transport = new HttpTransport(config, new Logger(false));

    transport.send([
      makeEvent({ id: "1" }),
      makeEvent({ id: "2" }),
      makeEvent({ id: "3" }),
      makeEvent({ id: "4" }),
    ]);

    await transport.flush();
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.events).toHaveLength(3);
    expect(body.events.map((e: AIRequestEvent) => e.id)).toEqual([
      "2",
      "3",
      "4",
    ]);
    await transport.shutdown();
  });

  it("throws on non-ok HTTP responses (triggering retry logic)", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
    const onError = vi.fn();
    const config = resolveConfig({
      apiKey: "nz_live_x",
      flushInterval: 0,
      maxRetries: 0,
      onError,
    });
    const transport = new HttpTransport(config, new Logger(false));

    transport.send([makeEvent()]);
    await transport.flush();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].error.message).toContain("500");
    await transport.shutdown();
  });

  it("never throws from send() even with a broken onError callback", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    const config = resolveConfig({
      apiKey: "nz_live_x",
      flushInterval: 0,
      maxRetries: 0,
      onError: () => {
        throw new Error("onError itself is broken");
      },
    });
    const transport = new HttpTransport(config, new Logger(false));

    expect(() => transport.send([makeEvent()])).not.toThrow();
    await expect(transport.flush()).resolves.toBeUndefined();
    await transport.shutdown();
  });

  it("stops accepting events after shutdown", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    const config = resolveConfig({ apiKey: "nz_live_x", flushInterval: 0 });
    const transport = new HttpTransport(config, new Logger(false));

    await transport.shutdown();
    transport.send([makeEvent()]);
    await transport.flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
