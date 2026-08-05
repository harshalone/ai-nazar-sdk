import type { NazarClient } from "../client.js";
import { estimateCost } from "../utils/cost.js";

/**
 * Shared observer-proxy machinery used by every `wrapX` provider
 * middleware (`wrapOpenAI`, `wrapAnthropic`, `wrapGemini`, `wrapOpenRouter`,
 * ...). Each provider middleware supplies a `ProviderAdapter` describing
 * where its call sites live and how to pull tokens/prompt/model out of its
 * particular request and response shapes; this module handles the actual
 * proxying, promise instrumentation, and event recording so that behavior
 * (never mutate args, never swallow errors, never change return values) is
 * identical across providers.
 */

interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/** Per-provider description of what to instrument and how to read it. */
export interface ProviderAdapter {
  /** Value stored on `AIRequestEvent.provider`, e.g. "anthropic". */
  provider: string;

  /** Dot-paths (relative to the client root) to instrument, e.g. "messages.create". */
  instrumentedPaths: Set<string>;

  /** Extract the model name from the request body (first argument). */
  getModel(requestBody: Record<string, unknown>): string;

  /**
   * Whether this call is a streaming request that shouldn't be summarized
   * for usage. Receives the request body and the instrumented dot-path
   * (e.g. "chat.completions.create", "models.generateContentStream") so
   * adapters can detect streaming either from a request field (OpenAI,
   * Anthropic: `stream: true`) or from the method itself (Gemini: a
   * dedicated `generateContentStream` method with no `stream` field).
   */
  isStreaming(requestBody: Record<string, unknown>, dotPath: string): boolean;

  /** Extract prompt content to (optionally) capture. */
  getPrompt(requestBody: Record<string, unknown>): unknown;

  /** Extract token usage from a successful response. */
  getUsage(response: unknown): TokenUsage;
}

export function createObserverWrap<T extends object>(
  nazarClient: NazarClient,
  target: T,
  adapter: ProviderAdapter,
): T {
  return createObservingProxy(nazarClient, target, [], adapter);
}

function createObservingProxy<T extends object>(
  nazarClient: NazarClient,
  target: T,
  path: string[],
  adapter: ProviderAdapter,
): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);

      if (typeof prop !== "string") return value;

      const nextPath = [...path, prop];

      if (typeof value === "function") {
        const dotPath = nextPath.join(".");
        if (adapter.instrumentedPaths.has(dotPath)) {
          return instrumentMethod(
            nazarClient,
            value as (...a: unknown[]) => unknown,
            obj,
            adapter,
            dotPath,
          );
        }
        // Non-instrumented methods are bound and passed through untouched
        // — original behavior is preserved.
        return value.bind(obj);
      }

      if (value !== null && typeof value === "object") {
        return createObservingProxy(nazarClient, value, nextPath, adapter);
      }

      return value;
    },
  });
}

function instrumentMethod(
  nazarClient: NazarClient,
  originalMethod: (...args: unknown[]) => unknown,
  thisArg: unknown,
  adapter: ProviderAdapter,
  dotPath: string,
) {
  return function instrumented(...args: unknown[]) {
    const startedAt = Date.now();
    const requestBody = (args[0] ?? {}) as Record<string, unknown>;
    const model = adapter.getModel(requestBody);
    const isStreaming = adapter.isStreaming(requestBody, dotPath);

    let result: unknown;
    try {
      result = originalMethod.apply(thisArg, args);
    } catch (err) {
      // Synchronous throw from the original call — record and rethrow
      // completely unmodified.
      recordError(nazarClient, adapter, err, model, startedAt, requestBody);
      throw err;
    }

    // Provider SDKs return a thenable for both streaming and non-streaming
    // calls. We attach observers via .then()/.catch() without consuming or
    // replacing the promise itself, so the original resolution value and
    // control flow are fully preserved for the caller.
    if (isPromiseLike(result)) {
      if (isStreaming) {
        // Streaming responses aren't easily summarized (no aggregate usage
        // until the stream completes) in this version — we still record
        // latency-to-first-response and pass the stream through untouched.
        return (result as Promise<unknown>).then(
          (streamResult) => {
            recordSuccess(nazarClient, adapter, model, startedAt, requestBody, {
              streaming: true,
            });
            return streamResult;
          },
          (err) => {
            recordError(
              nazarClient,
              adapter,
              err,
              model,
              startedAt,
              requestBody,
            );
            throw err;
          },
        );
      }

      return (result as Promise<unknown>).then(
        (response) => {
          recordSuccess(
            nazarClient,
            adapter,
            model,
            startedAt,
            requestBody,
            response,
          );
          return response;
        },
        (err) => {
          recordError(nazarClient, adapter, err, model, startedAt, requestBody);
          throw err;
        },
      );
    }

    // Non-promise return (shouldn't normally happen for instrumented
    // methods, but fall through safely rather than assuming shape).
    return result;
  };
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function recordSuccess(
  nazarClient: NazarClient,
  adapter: ProviderAdapter,
  model: string,
  startedAt: number,
  requestBody: Record<string, unknown>,
  response: unknown,
): void {
  try {
    const latency = Date.now() - startedAt;
    const { inputTokens, outputTokens } = adapter.getUsage(response);

    const cost =
      inputTokens !== undefined && outputTokens !== undefined
        ? estimateCost(adapter.provider, model, inputTokens, outputTokens)
        : undefined;

    nazarClient.track({
      provider: adapter.provider,
      model,
      inputTokens,
      outputTokens,
      latency,
      cost,
      status: "success",
      prompt: adapter.getPrompt(requestBody),
      response,
    });
  } catch {
    // Observability code must never disrupt the original call — swallow
    // and move on. (This is the one intentional silent catch in the SDK:
    // it guards purely internal bookkeeping that has already returned
    // control to the caller.)
  }
}

function recordError(
  nazarClient: NazarClient,
  adapter: ProviderAdapter,
  err: unknown,
  model: string,
  startedAt: number,
  requestBody: Record<string, unknown>,
): void {
  try {
    const latency = Date.now() - startedAt;
    const normalized = normalizeProviderError(err);

    nazarClient.track({
      provider: adapter.provider,
      model,
      latency,
      status: "error",
      error: normalized,
      prompt: adapter.getPrompt(requestBody),
    });
  } catch {
    // See note in recordSuccess.
  }
}

function normalizeProviderError(err: unknown): {
  message: string;
  stack?: string;
  code?: string;
  statusCode?: number;
} {
  if (err instanceof Error) {
    const withExtras = err as Error & { status?: number; code?: string };
    return {
      message: err.message,
      stack: err.stack,
      code: withExtras.code,
      statusCode: withExtras.status,
    };
  }
  return { message: String(err) };
}
