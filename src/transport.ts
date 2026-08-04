import type { AIRequestEvent, NazarConfig, Transport } from "./types.js";
import { computeBackoffDelay, sleep } from "./utils/backoff.js";
import type { Logger } from "./utils/logger.js";

/**
 * Default HTTP transport: buffers events in memory, flushes on a timer
 * or when a batch fills up, retries failed deliveries with exponential
 * backoff, and drops the oldest events if the queue overflows.
 *
 * Design goals (in priority order):
 *   1. Never throw into the caller's application.
 *   2. Never block the caller's AI request on network I/O.
 *   3. Don't lose events under transient failures (retry + backoff).
 *   4. Degrade gracefully when truly offline or misconfigured.
 */
export class HttpTransport implements Transport {
  private queue: AIRequestEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> = Promise.resolve();
  private shuttingDown = false;

  constructor(
    private readonly config: NazarConfig,
    private readonly logger: Logger,
  ) {
    if (this.config.flushInterval > 0) {
      this.flushTimer = setInterval(() => {
        void this.flush();
      }, this.config.flushInterval);
      this.flushTimer.unref?.();
    }
  }

  send(events: AIRequestEvent[]): void {
    if (this.shuttingDown) return;

    for (const event of events) {
      this.queue.push(event);
    }

    if (this.queue.length > this.config.maxQueueSize) {
      const overflow = this.queue.length - this.config.maxQueueSize;
      this.queue.splice(0, overflow);
      this.logger.warn(
        `queue exceeded maxQueueSize (${this.config.maxQueueSize}); dropped ${overflow} oldest event(s)`,
      );
    }

    if (this.queue.length >= this.config.batchSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    // Chain onto any in-flight flush so concurrent callers don't race
    // each other draining the queue.
    this.inFlight = this.inFlight.then(() => this.drainQueue());
    return this.inFlight;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  private async drainQueue(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.config.batchSize);
      await this.deliverWithRetry(batch);
    }
  }

  private async deliverWithRetry(batch: AIRequestEvent[]): Promise<void> {
    let attempt = 0;

    for (;;) {
      try {
        await this.deliver(batch);
        this.logger.debug(`delivered batch of ${batch.length} event(s)`);
        return;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const willRetry = attempt < this.config.maxRetries;

        this.logger.debug(
          `delivery attempt ${attempt + 1} failed: ${error.message}${
            willRetry ? " (retrying)" : " (giving up)"
          }`,
        );

        this.safeOnError({
          events: batch,
          error,
          attempt: attempt + 1,
          willRetry,
        });

        if (!willRetry) return;

        await sleep(computeBackoffDelay(attempt, this.config.retryBaseDelay));
        attempt += 1;
      }
    }
  }

  private safeOnError(
    failure: Parameters<NonNullable<NazarConfig["onError"]>>[0],
  ): void {
    if (!this.config.onError) return;
    try {
      this.config.onError(failure);
    } catch (err) {
      this.logger.warn("onError callback threw", err);
    }
  }

  private async deliver(batch: AIRequestEvent[]): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.requestTimeout,
    );

    try {
      const response = await fetch(`${this.config.endpoint}/v1/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
          "x-nazar-sdk": "ai-nazar-js",
        },
        body: JSON.stringify({ events: batch }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `AI Nazar API responded with ${response.status} ${response.statusText}`,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** No-op transport used when the SDK is disabled (`enabled: false`). */
export class NoopTransport implements Transport {
  send(): void {}
  async flush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}
