import type { NazarClient } from "../client.js";
import { estimateCost } from "../utils/cost.js";

/**
 * `wrapOpenAI` is an OBSERVER, not a replacement client.
 *
 * It returns a `Proxy` around the SDK instance you pass in. Every property
 * access and method call is forwarded, unmodified, to the real client —
 * this wrapper only *observes* calls to `chat.completions.create` (and
 * the streaming variant) to record timing, token usage, and errors. It
 * never changes arguments, never changes the returned value, and never
 * swallows an error.
 *
 * This means adopting AI Nazar requires a one-line change:
 *
 *   const openai = Nazar.wrapOpenAI(new OpenAI());
 *
 * Every other line of existing code — including destructuring,
 * `.chat.completions.create(...)`, streaming, error handling — keeps
 * working exactly as before.
 */
export function wrapOpenAI<T extends object>(
  client: NazarClient,
  openai: T,
): T {
  return createObservingProxy(client, openai, []);
}

// Methods we instrument. Keyed by dot-path from the client root.
const INSTRUMENTED_PATHS = new Set(["chat.completions.create"]);

function createObservingProxy<T extends object>(
  nazarClient: NazarClient,
  target: T,
  path: string[],
): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);

      if (typeof prop !== "string") return value;

      const nextPath = [...path, prop];

      if (typeof value === "function") {
        const dotPath = nextPath.join(".");
        if (INSTRUMENTED_PATHS.has(dotPath)) {
          return instrumentMethod(
            nazarClient,
            value as (...a: unknown[]) => unknown,
            obj,
          );
        }
        // Non-instrumented methods (e.g. embeddings.create) are bound and
        // passed through untouched — the original behavior is preserved.
        return value.bind(obj);
      }

      if (value !== null && typeof value === "object") {
        return createObservingProxy(nazarClient, value, nextPath);
      }

      return value;
    },
  });
}

interface UsageShape {
  prompt_tokens?: number;
  completion_tokens?: number;
}

function instrumentMethod(
  nazarClient: NazarClient,
  originalMethod: (...args: unknown[]) => unknown,
  thisArg: unknown,
) {
  return function instrumented(...args: unknown[]) {
    const startedAt = Date.now();
    const requestBody = (args[0] ?? {}) as Record<string, unknown>;
    const model =
      typeof requestBody.model === "string" ? requestBody.model : "unknown";
    const isStreaming = requestBody.stream === true;

    let result: unknown;
    try {
      result = originalMethod.apply(thisArg, args);
    } catch (err) {
      // Synchronous throw from the original call — record and rethrow
      // completely unmodified.
      recordError(nazarClient, err, model, startedAt, requestBody);
      throw err;
    }

    // The OpenAI SDK returns a thenable (APIPromise) for non-streaming
    // calls. We attach observers via .then()/.catch() without consuming
    // or replacing the promise itself, so the original resolution value
    // and control flow are fully preserved for the caller.
    if (isPromiseLike(result)) {
      if (isStreaming) {
        // Streaming responses aren't easily summarized (no aggregate
        // usage until the stream completes) in this first version — we
        // still record latency-to-first-response and pass the stream
        // through completely untouched.
        return (result as Promise<unknown>).then(
          (streamResult) => {
            recordSuccess(nazarClient, model, startedAt, requestBody, {
              streaming: true,
            });
            return streamResult;
          },
          (err) => {
            recordError(nazarClient, err, model, startedAt, requestBody);
            throw err;
          },
        );
      }

      return (result as Promise<unknown>).then(
        (response) => {
          recordSuccess(nazarClient, model, startedAt, requestBody, response);
          return response;
        },
        (err) => {
          recordError(nazarClient, err, model, startedAt, requestBody);
          throw err;
        },
      );
    }

    // Non-promise return (shouldn't normally happen for this method, but
    // fall through safely rather than assuming shape).
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
  model: string,
  startedAt: number,
  requestBody: Record<string, unknown>,
  response: unknown,
): void {
  try {
    const latency = Date.now() - startedAt;
    const usage = (response as { usage?: UsageShape } | undefined)?.usage;

    const inputTokens = usage?.prompt_tokens;
    const outputTokens = usage?.completion_tokens;

    const cost =
      inputTokens !== undefined && outputTokens !== undefined
        ? estimateOpenAICost(model, inputTokens, outputTokens)
        : undefined;

    nazarClient.track({
      provider: "openai",
      model,
      inputTokens,
      outputTokens,
      latency,
      cost,
      status: "success",
      prompt: requestBody.messages,
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
  err: unknown,
  model: string,
  startedAt: number,
  requestBody: Record<string, unknown>,
): void {
  try {
    const latency = Date.now() - startedAt;
    const normalized = normalizeOpenAIError(err);

    nazarClient.track({
      provider: "openai",
      model,
      latency,
      status: "error",
      error: normalized,
      prompt: requestBody.messages,
    });
  } catch {
    // See note in recordSuccess.
  }
}

function normalizeOpenAIError(err: unknown): {
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

function estimateOpenAICost(
  model: string,
  inputTokens: number,
  outputTokens: number,
) {
  return estimateCost("openai", model, inputTokens, outputTokens);
}
