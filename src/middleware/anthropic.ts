import type { NazarClient } from "../client.js";
import { createObserverWrap, type ProviderAdapter } from "./shared.js";

/**
 * `wrapAnthropic` is an OBSERVER, not a replacement client.
 *
 * It returns a `Proxy` around the Anthropic SDK instance you pass in.
 * Every property access and method call is forwarded, unmodified, to the
 * real client — this wrapper only *observes* calls to `messages.create`
 * to record timing, token usage, and errors. It never changes arguments,
 * never changes the returned value, and never swallows an error.
 *
 *   const anthropic = Nazar.wrapAnthropic(new Anthropic());
 *
 * Every other line of existing code — including destructuring,
 * `.messages.create(...)`, streaming, error handling — keeps working
 * exactly as before.
 */
export function wrapAnthropic<T extends object>(
  client: NazarClient,
  anthropic: T,
): T {
  return createObserverWrap(client, anthropic, anthropicAdapter);
}

interface UsageShape {
  input_tokens?: number;
  output_tokens?: number;
}

const anthropicAdapter: ProviderAdapter = {
  provider: "anthropic",
  instrumentedPaths: new Set(["messages.create"]),

  getModel(requestBody) {
    return typeof requestBody.model === "string"
      ? requestBody.model
      : "unknown";
  },

  isStreaming(requestBody, _dotPath) {
    return requestBody.stream === true;
  },

  getPrompt(requestBody) {
    if (requestBody.system === undefined) return requestBody.messages;
    return { system: requestBody.system, messages: requestBody.messages };
  },

  getUsage(response) {
    const usage = (response as { usage?: UsageShape } | undefined)?.usage;
    return {
      inputTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
    };
  },
};
