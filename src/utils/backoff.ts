/** Exponential backoff with jitter, capped at 30s. */
export function computeBackoffDelay(
  attempt: number,
  baseDelay: number,
): number {
  const exponential = baseDelay * 2 ** attempt;
  const capped = Math.min(exponential, 30_000);
  const jitter = Math.random() * capped * 0.2;
  return Math.round(capped - jitter / 2 + jitter);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
