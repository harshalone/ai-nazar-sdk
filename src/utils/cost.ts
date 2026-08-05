/**
 * Static USD-per-1M-token pricing table, used to estimate cost when a
 * caller doesn't supply one explicitly. This is necessarily approximate
 * and will drift from list prices over time — it exists so `wrapOpenAI`
 * can populate `cost` automatically. Callers who need precise billing
 * numbers should pass `cost` explicitly to `track()`.
 *
 * Keyed by `${provider}:${model}`. Add entries here as new models ship;
 * unknown models fall back to `undefined` (no cost estimate) rather than
 * a guess.
 */
const PRICING_PER_MILLION_TOKENS: Record<
  string,
  { input: number; output: number }
> = {
  "openai:gpt-4o": { input: 2.5, output: 10 },
  "openai:gpt-4o-mini": { input: 0.15, output: 0.6 },
  "openai:gpt-4-turbo": { input: 10, output: 30 },
  "openai:gpt-4": { input: 30, output: 60 },
  "openai:gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  "openai:gpt-5.5": { input: 3, output: 12 },
  "openai:o1": { input: 15, output: 60 },
  "openai:o1-mini": { input: 3, output: 12 },

  "anthropic:claude-sonnet-5": { input: 3, output: 15 },
  "anthropic:claude-opus-5": { input: 15, output: 75 },
  "anthropic:claude-haiku-4.5": { input: 1, output: 5 },
  "anthropic:claude-3-5-sonnet-20241022": { input: 3, output: 15 },
  "anthropic:claude-3-5-haiku-20241022": { input: 0.8, output: 4 },
  "anthropic:claude-3-opus-20240229": { input: 15, output: 75 },

  "gemini:gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini:gemini-2.0-flash-lite": { input: 0.075, output: 0.3 },
  "gemini:gemini-1.5-pro": { input: 1.25, output: 5 },
  "gemini:gemini-1.5-flash": { input: 0.075, output: 0.3 },

  // OpenRouter is a routing layer over many upstream providers/models with
  // its own per-route pricing (and per-request price variance for
  // some models) — no static table is maintained here. `cost` stays
  // `undefined` for OpenRouter calls unless the caller supplies it
  // explicitly to `track()`.
};

/** Normalizes a model name to increase the odds of a pricing table hit. */
function normalizeModel(model: string): string {
  return model.trim().toLowerCase();
}

/**
 * Estimates cost in USD given provider, model, and token counts. Returns
 * `undefined` when the model isn't in the pricing table — callers should
 * treat that as "unknown", not "free".
 */
export function estimateCost(
  provider: string,
  model: string,
  inputTokens = 0,
  outputTokens = 0,
): number | undefined {
  const key = `${provider.toLowerCase()}:${normalizeModel(model)}`;
  const pricing = PRICING_PER_MILLION_TOKENS[key];
  if (!pricing) return undefined;

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return Number((inputCost + outputCost).toFixed(8));
}
