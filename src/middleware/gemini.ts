import type { NazarClient } from "../client.js";
import { createObserverWrap, type ProviderAdapter } from "./shared.js";

/**
 * `wrapGemini` is an OBSERVER, not a replacement client.
 *
 * It returns a `Proxy` around the `@google/genai` client instance you pass
 * in. Every property access and method call is forwarded, unmodified, to
 * the real client — this wrapper only *observes* calls to
 * `models.generateContent` (and the streaming variant) to record timing,
 * token usage, and errors. It never changes arguments, never changes the
 * returned value, and never swallows an error.
 *
 *   const ai = Nazar.wrapGemini(new GoogleGenAI({ apiKey }));
 *
 * Every other line of existing code — including
 * `.models.generateContent(...)`, streaming, error handling — keeps
 * working exactly as before.
 */
export function wrapGemini<T extends object>(client: NazarClient, ai: T): T {
  return createObserverWrap(client, ai, geminiAdapter);
}

interface UsageMetadataShape {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
}

const geminiAdapter: ProviderAdapter = {
  provider: "gemini",
  // Gemini's request shape puts `model`/`contents` inside a single params
  // object. Both the non-streaming and streaming methods are instrumented;
  // `isStreaming` tells the shared core which one it's looking at.
  instrumentedPaths: new Set([
    "models.generateContent",
    "models.generateContentStream",
  ]),

  getModel(requestBody) {
    return typeof requestBody.model === "string"
      ? requestBody.model
      : "unknown";
  },

  isStreaming(_requestBody, dotPath) {
    // Unlike OpenAI/Anthropic, Gemini has no `stream: true` request field —
    // streaming is a distinct method (`generateContentStream`) that
    // resolves to an AsyncGenerator rather than a single response with
    // aggregate usage, so detect it from the dot-path instead.
    return dotPath === "models.generateContentStream";
  },

  getPrompt(requestBody) {
    return requestBody.contents;
  },

  getUsage(response) {
    const usageMetadata = (
      response as { usageMetadata?: UsageMetadataShape } | undefined
    )?.usageMetadata;
    return {
      inputTokens: usageMetadata?.promptTokenCount,
      outputTokens: usageMetadata?.candidatesTokenCount,
    };
  },
};
