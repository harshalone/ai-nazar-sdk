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
