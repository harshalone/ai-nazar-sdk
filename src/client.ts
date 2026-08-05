import { resolveConfig } from "./config.js";
import { HttpTransport, NoopTransport } from "./transport.js";
import type {
  AIRequestEvent,
  CaptureExceptionContext,
  NazarConfig,
  NazarOptions,
  Transport,
} from "./types.js";
import { applyRedaction } from "./utils/redact.js";
import { generateId } from "./utils/id.js";
import { Logger } from "./utils/logger.js";

export const SDK_NAME = "ai-nazar";
export const SDK_VERSION = "0.2.0";

/**
 * The AI Nazar client. Construct via `Nazar.init()` rather than directly —
 * see index.ts for the public factory and singleton accessor.
 */
export class NazarClient {
  readonly config: NazarConfig;
  private readonly transport: Transport;
  private readonly logger: Logger;

  constructor(options: NazarOptions) {
    this.config = resolveConfig(options);
    this.logger = new Logger(this.config.debug);
    this.transport = this.config.enabled
      ? (this.config.transport ?? new HttpTransport(this.config, this.logger))
      : new NoopTransport();

    if (this.config.debug) {
      this.logger.debug(
        `initialized (environment=${this.config.environment}, endpoint=${this.config.endpoint}, enabled=${this.config.enabled})`,
      );
    }
  }

  /**
   * Record an AI request observation. Safe to call from hot paths — this
   * never blocks on network I/O and never throws, even with malformed
   * input, so it can't take down the host application.
   */
  track(input: {
    provider: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    latency?: number;
    cost?: number;
    status?: AIRequestEvent["status"];
    error?: AIRequestEvent["error"];
    userId?: string;
    metadata?: Record<string, unknown>;
    prompt?: unknown;
    response?: unknown;
    requestId?: string;
    id?: string;
    timestamp?: number;
  }): void {
    try {
      if (!this.config.enabled) return;

      if (!input || typeof input !== "object") {
        this.logger.warn("track() called with invalid input; ignoring");
        return;
      }

      if (!input.provider || !input.model) {
        this.logger.warn(
          "track() requires both 'provider' and 'model'; ignoring event",
        );
        return;
      }

      const event = this.buildEvent(input);
      this.transport.send([event]);
    } catch (err) {
      // track() must never throw into the caller's application.
      this.logger.warn("track() failed unexpectedly", err);
    }
  }

  /**
   * Record an error/exception encountered while calling an AI provider.
   * Friendlier sibling of `track({ status: "error", ... })`.
   */
  captureException(
    error: unknown,
    context: CaptureExceptionContext = {},
  ): void {
    try {
      if (!this.config.enabled) return;

      const normalized = this.normalizeError(error);

      const event = this.buildEvent({
        provider: context.provider ?? "unknown",
        model: context.model ?? "unknown",
        status: "error",
        error: normalized,
        userId: context.userId,
        metadata: context.metadata,
        id: context.requestId,
      });

      this.transport.send([event]);
    } catch (err) {
      this.logger.warn("captureException() failed unexpectedly", err);
    }
  }

  /** Flush the local queue immediately. Useful before short-lived processes exit. */
  async flush(): Promise<void> {
    try {
      await this.transport.flush();
    } catch (err) {
      this.logger.warn("flush() failed", err);
    }
  }

  /** Flush and stop background timers. Call on graceful shutdown. */
  async shutdown(): Promise<void> {
    try {
      await this.transport.shutdown();
    } catch (err) {
      this.logger.warn("shutdown() failed", err);
    }
  }

  /** @internal Exposed for middleware (e.g. wrapOpenAI) that need config-aware redaction. */
  redact(value: unknown): unknown {
    return applyRedaction(value, {
      redactSensitiveData: this.config.redactSensitiveData,
      redact: this.config.redact,
      log: (...a) => this.logger.debug(...a),
    });
  }

  private buildEvent(input: {
    provider: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    latency?: number;
    cost?: number;
    status?: AIRequestEvent["status"];
    error?: AIRequestEvent["error"];
    userId?: string;
    metadata?: Record<string, unknown>;
    prompt?: unknown;
    response?: unknown;
    id?: string;
    timestamp?: number;
  }): AIRequestEvent {
    const event: AIRequestEvent = {
      id: input.id ?? generateId(),
      provider: input.provider,
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      latency: input.latency,
      cost: input.cost,
      status: input.status ?? "success",
      error: input.error,
      environment: this.config.environment,
      userId: input.userId,
      metadata: input.metadata,
      timestamp: input.timestamp ?? Date.now(),
      sdk: { name: SDK_NAME, version: SDK_VERSION },
    };

    if (this.config.capturePrompts && input.prompt !== undefined) {
      event.prompt = this.redact(input.prompt);
    }

    if (this.config.captureResponses && input.response !== undefined) {
      event.response = this.redact(input.response);
    }

    if (event.metadata && this.config.redactSensitiveData) {
      event.metadata = this.redact(event.metadata) as Record<string, unknown>;
    }

    return event;
  }

  private normalizeError(error: unknown): { message: string; stack?: string } {
    if (error instanceof Error) {
      return { message: error.message, stack: error.stack };
    }
    if (typeof error === "string") {
      return { message: error };
    }
    try {
      return { message: JSON.stringify(error) };
    } catch {
      return { message: "Unknown error (not serializable)" };
    }
  }
}
