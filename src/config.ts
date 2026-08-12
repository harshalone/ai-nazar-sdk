import type { NazarConfig, NazarOptions } from "./types.js";

export const DEFAULT_ENDPOINT = "https://www.ainazar.com/api";

const DEFAULTS = {
  environment: "development",
  capturePrompts: false,
  captureResponses: false,
  redactSensitiveData: true,
  maxQueueSize: 1000,
  batchSize: 20,
  flushInterval: 5000,
  maxRetries: 3,
  retryBaseDelay: 500,
  requestTimeout: 10_000,
  debug: false,
  enabled: true,
} as const satisfies Partial<NazarConfig>;

/** Detects the runtime environment from common env vars, best-effort. */
export function detectEnvironment(): string {
  const env =
    (typeof process !== "undefined" && process.env
      ? process.env.NAZAR_ENVIRONMENT ||
        process.env.NODE_ENV ||
        process.env.VERCEL_ENV
      : undefined) ?? "development";
  return env;
}

export class NazarConfigError extends Error {
  constructor(message: string) {
    super(`[AI Nazar] Invalid configuration: ${message}`);
    this.name = "NazarConfigError";
  }
}

/**
 * Merge user-supplied options with defaults, validating required fields.
 * Throws `NazarConfigError` with a helpful message on misconfiguration —
 * this only happens at `init()` time, never during request tracking.
 */
export function resolveConfig(options: NazarOptions): NazarConfig {
  if (!options || typeof options !== "object") {
    throw new NazarConfigError(
      "options object is required, e.g. Nazar.init({ apiKey: 'nz_live_...' })",
    );
  }

  if (!options.apiKey || typeof options.apiKey !== "string") {
    throw new NazarConfigError(
      "'apiKey' is required. Get one at https://ainazar.com/dashboard/api-keys",
    );
  }

  if (options.batchSize !== undefined && options.batchSize <= 0) {
    throw new NazarConfigError("'batchSize' must be a positive number");
  }

  if (options.maxQueueSize !== undefined && options.maxQueueSize <= 0) {
    throw new NazarConfigError("'maxQueueSize' must be a positive number");
  }

  const endpoint = (options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, "");

  return {
    apiKey: options.apiKey,
    endpoint,
    environment: options.environment ?? detectEnvironment(),
    capturePrompts: options.capturePrompts ?? DEFAULTS.capturePrompts,
    captureResponses: options.captureResponses ?? DEFAULTS.captureResponses,
    redactSensitiveData:
      options.redactSensitiveData ?? DEFAULTS.redactSensitiveData,
    redact: options.redact,
    maxQueueSize: options.maxQueueSize ?? DEFAULTS.maxQueueSize,
    batchSize: options.batchSize ?? DEFAULTS.batchSize,
    flushInterval: options.flushInterval ?? DEFAULTS.flushInterval,
    maxRetries: options.maxRetries ?? DEFAULTS.maxRetries,
    retryBaseDelay: options.retryBaseDelay ?? DEFAULTS.retryBaseDelay,
    requestTimeout: options.requestTimeout ?? DEFAULTS.requestTimeout,
    debug: options.debug ?? DEFAULTS.debug,
    enabled: options.enabled ?? DEFAULTS.enabled,
    onError: options.onError,
    transport: options.transport,
  };
}
