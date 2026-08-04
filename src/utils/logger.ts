/** Minimal internal logger, gated by `debug` config. Never throws. */
export class Logger {
  constructor(private readonly enabled: boolean) {}

  debug(...args: unknown[]): void {
    if (this.enabled) {
      // eslint-disable-next-line no-console
      console.debug("[AI Nazar]", ...args);
    }
  }

  warn(...args: unknown[]): void {
    console.warn("[AI Nazar]", ...args);
  }

  error(...args: unknown[]): void {
    console.error("[AI Nazar]", ...args);
  }
}
