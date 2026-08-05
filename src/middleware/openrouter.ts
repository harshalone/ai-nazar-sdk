import type { NazarClient } from "../client.js";
import { createObserverWrap, type ProviderAdapter } from "./shared.js";

/**
 * `wrapOpenRouter` is an OBSERVER, not a replacement client.
 *
 * OpenRouter exposes an OpenAI-compatible API, so the idiomatic way to
 * call it from Node is the official `openai` package pointed at
 * OpenRouter's base URL:
 *
 *   const openrouter = Nazar.wrapOpenRouter(new OpenAI({
 *     baseURL: "https://openrouter.ai/api/v1",
 *     apiKey: process.env.OPENROUTER_API_KEY,
 *   }));
 *
 * The request/response shape instrumented here (`chat.completions.create`,
 * `usage.prompt_tokens` / `usage.completion_tokens`) is identical to
 * `wrapOpenAI` — the only difference is the recorded `provider` ("openrouter")
 * and the `model` value, which is OpenRouter's `vendor/model` slug (e.g.
 * `"anthropic/claude-sonnet-5"`) rather than a bare OpenAI model name. As
 * with every wrapper in this SDK: arguments are never mutated, return
 * values are never changed, and errors are never swallowed.
 */
export function wrapOpenRouter<T extends object>(
  client: NazarClient,
  openrouter: T,
): T {
  return createObserverWrap(client, openrouter, openRouterAdapter);
}

interface UsageShape {
  prompt_tokens?: number;
  completion_tokens?: number;
}

const openRouterAdapter: ProviderAdapter = {
  provider: "openrouter",
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
