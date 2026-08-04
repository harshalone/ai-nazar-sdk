import type { AIRequestEvent, Transport } from "../../src/types.js";

/** In-memory transport for tests: records everything sent, no network I/O. */
export class MemoryTransport implements Transport {
  events: AIRequestEvent[] = [];
  flushCount = 0;
  shutdownCalled = false;

  send(events: AIRequestEvent[]): void {
    this.events.push(...events);
  }

  async flush(): Promise<void> {
    this.flushCount += 1;
  }

  async shutdown(): Promise<void> {
    this.shutdownCalled = true;
  }
}
