import type { NazarClient } from "../client.js";
import { createObserverWrap, type ProviderAdapter } from "./shared.js";

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
  return createObserverWrap(client, openai, openAIAdapter);
}

interface UsageShape {
  prompt_tokens?: number;
  completion_tokens?: number;
}

const openAIAdapter: ProviderAdapter = {
  provider: "openai",
  instrumentedPaths: new Set(["chat.completions.create"]),

  getModel(requestBody) {
    return typeof requestBody.model === "string"
      ? requestBody.model
      : "unknown";
  },

  isStreaming(requestBody, _dotPath) {
    return requestBody.stream === true;
  },

  getPrompt(requestBody) {
    return requestBody.messages;
  },

  getUsage(response) {
    const usage = (response as { usage?: UsageShape } | undefined)?.usage;
    return {
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
    };
  },
};
