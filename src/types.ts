/**
 * Core type definitions for AI Nazar.
 *
 * These types are intentionally provider-agnostic. `provider` and `model`
 * are plain strings (not enums) so that new providers (Anthropic, Gemini,
 * local models, etc.) never require a breaking change to this package.
 */

/**
 * Lifecycle environment the SDK is running in. Uses the `string & {}`
 * trick so editors still autocomplete the well-known values while any
 * other string remains assignable.
 */
export type NazarEnvironment =
  | "development"
  | "staging"
  | "production"
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});

/** Outcome of a tracked AI request. */
export type AIRequestStatus = "success" | "error";

/** Structured error information attached to a failed request event. */
export interface AIRequestError {
  message: string;
  stack?: string;
  /** Provider-specific error code, e.g. "rate_limit_exceeded". */
  code?: string;
  /** HTTP status code, if the error originated from an HTTP call. */
  statusCode?: number;
}

/**
 * A single AI request observation. This is the fundamental unit of data
 * AI Nazar collects and ships to the backend.
 */
export interface AIRequestEvent {
  /** Unique event ID. Auto-generated if omitted. */
  id?: string;

  /** e.g. "openai", "anthropic", "gemini", "custom". */
  provider: string;

  /** e.g. "gpt-5.5", "claude-4.5-sonnet". */
  model: string;

  /** Number of input/prompt tokens consumed. */
  inputTokens?: number;

  /** Number of output/completion tokens generated. */
  outputTokens?: number;

  /** Wall-clock request duration in milliseconds. */
  latency?: number;

  /** Estimated cost in USD. */
  cost?: number;

  status: AIRequestStatus;

  error?: AIRequestError;

  environment?: NazarEnvironment;

  /** Application-defined end-user identifier, for per-user cost/usage views. */
  userId?: string;

  /**
   * Free-form structured metadata. Always sent, regardless of privacy
   * settings — do not put prompt/response content here directly; use
   * `prompt` / `response` instead, which are gated by capture settings.
   */
  metadata?: Record<string, unknown>;

  /**
   * Raw prompt content. Only populated when `capturePrompts` is enabled.
   * Subject to `redactSensitiveData` / `redact` before being queued.
   */
  prompt?: unknown;

  /**
   * Raw response content. Only populated when `captureResponses` is
   * enabled. Subject to `redactSensitiveData` / `redact` before being
   * queued.
   */
  response?: unknown;

  /** Epoch milliseconds when the event was recorded. */
  timestamp: number;

  /** SDK identifier, injected automatically. */
  sdk?: {
    name: string;
    version: string;
  };
}

/** Input shape accepted by `nazar.track()` — `timestamp` is optional. */
export type TrackInput = Omit<AIRequestEvent, "timestamp" | "sdk"> & {
  timestamp?: number;
};

/**
 * A redaction function receives an arbitrary value (prompt or response
 * payload) and returns a sanitized version safe to transmit.
 */
export type RedactFn = (value: unknown) => unknown;

/** Optional context passed to `captureException`. */
export interface CaptureExceptionContext {
  provider?: string;
  model?: string;
  requestId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Transport-level delivery outcome, surfaced to `onError` / debug logging.
 */
export interface TransportFailure {
  events: AIRequestEvent[];
  error: Error;
  attempt: number;
  willRetry: boolean;
}

/** Pluggable transport interface — the default is HTTP fetch-based. */
export interface Transport {
  /** Enqueue events for delivery. Must never throw. */
  send(events: AIRequestEvent[]): void;
  /** Flush all queued events, resolving once delivery attempts finish. */
  flush(): Promise<void>;
  /** Stop any background timers (e.g. on process shutdown). */
  shutdown(): Promise<void>;
}

/** Full resolved SDK configuration (after defaults are applied). */
export interface NazarConfig {
  apiKey: string;
  endpoint: string;
  environment: NazarEnvironment;

  /** Capture raw prompt content on tracked events. Default: false. */
  capturePrompts: boolean;

  /** Capture raw response content on tracked events. Default: false. */
  captureResponses: boolean;

  /**
   * Apply best-effort redaction (emails, API keys, secrets, etc.) to any
   * captured prompt/response/metadata content before it leaves the
   * process. Default: true.
   */
  redactSensitiveData: boolean;

  /** Custom redaction function, applied in addition to built-in redaction. */
  redact?: RedactFn;

  /** Max events held in memory before oldest events are dropped. */
  maxQueueSize: number;

  /** Max events sent per batch request. */
  batchSize: number;

  /** Interval (ms) between automatic batch flushes. */
  flushInterval: number;

  /** Max retry attempts for a failed batch delivery. */
  maxRetries: number;

  /** Base delay (ms) for exponential backoff between retries. */
  retryBaseDelay: number;

  /** Request timeout (ms) for delivering a batch. */
  requestTimeout: number;

  /** Enable verbose console logging for debugging the SDK itself. */
  debug: boolean;

  /** Globally disable the SDK — track()/wrap() become no-ops. */
  enabled: boolean;

  /** Called whenever a batch fails to deliver (after retries exhausted too). */
  onError?: (failure: TransportFailure) => void;

  /** Override the default transport (mainly for testing). */
  transport?: Transport;
}

/** User-supplied options for `Nazar.init()` — everything except apiKey is optional. */
export interface NazarOptions extends Partial<
  Omit<NazarConfig, "apiKey" | "transport">
> {
  apiKey: string;
  transport?: Transport;
}
