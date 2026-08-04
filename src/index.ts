import { NazarClient } from "./client.js";
import { wrapOpenAI as wrapOpenAIImpl } from "./middleware/openai.js";
import type { NazarOptions } from "./types.js";

export type {
  AIRequestEvent,
  AIRequestError,
  AIRequestStatus,
  CaptureExceptionContext,
  NazarConfig,
  NazarEnvironment,
  NazarOptions,
  RedactFn,
  Transport,
  TransportFailure,
} from "./types.js";
export { NazarClient } from "./client.js";
export { NazarConfigError } from "./config.js";

let activeClient: NazarClient | undefined;

/**
 * Static entry point for AI Nazar. Most applications only ever call
 * `Nazar.init()` once, then use the returned client (or `Nazar.getClient()`
 * from anywhere else in the app).
 */
export class Nazar {
  private constructor() {
    // Static-only class; use Nazar.init().
  }

  /**
   * Initialize the SDK. Safe to call once at application startup.
   *
   * @example
   * ```ts
   * const nazar = Nazar.init({
   *   apiKey: "nz_live_xxxxx",
   *   environment: "production",
   * });
   * ```
   */
  static init(options: NazarOptions): NazarClient {
    const client = new NazarClient(options);
    activeClient = client;
    return client;
  }

  /**
   * Retrieve the client created by the most recent `Nazar.init()` call.
   * Throws a clear error if `init()` hasn't been called yet — call this
   * only after your application has initialized the SDK.
   */
  static getClient(): NazarClient {
    if (!activeClient) {
      throw new Error(
        "[AI Nazar] Nazar.getClient() was called before Nazar.init(). " +
          "Call Nazar.init({ apiKey: '...' }) once at application startup.",
      );
    }
    return activeClient;
  }

  /**
   * Wrap an OpenAI client instance so its calls are observed by AI Nazar.
   *
   * This is a pure OBSERVER: it does not replace, proxy, or route your
   * OpenAI traffic. The wrapped client behaves identically to the
   * original — same responses, same errors, same streaming behavior —
   * AI Nazar just watches and records.
   *
   * @example
   * ```ts
   * const openai = Nazar.wrapOpenAI(new OpenAI());
   * // Use exactly as before:
   * await openai.chat.completions.create({ model: "gpt-5.5", messages });
   * ```
   */
  static wrapOpenAI<T extends object>(openai: T, client?: NazarClient): T {
    return wrapOpenAIImpl(client ?? Nazar.getClient(), openai);
  }

  /** Resets the singleton. Intended for tests only. */
  static _resetForTests(): void {
    activeClient = undefined;
  }
}
