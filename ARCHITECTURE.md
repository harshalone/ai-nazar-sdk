# AI Nazar SDK — Architecture

This document explains the design decisions behind the first version of
the AI Nazar SDK (`sdk/`) and how the architecture is meant to evolve.

## Design goals, in priority order

1. **Never break or slow down the host application.** Every public
   method must be safe to call from a hot path: non-blocking, and unable
   to throw an exception into caller code.
2. **Adoption friction near zero.** The existing line
   `openai.chat.completions.create(...)` must keep working, unmodified,
   after wrapping. See [Why an observer, not a gateway](#why-an-observer-not-a-gateway).
3. **Privacy by default.** Prompt/response content is opt-in, not opt-out.
4. **Provider-agnostic core.** Nothing in the event model or transport
   assumes OpenAI specifically — provider integrations are thin adapters
   on top of a shared core.

## Module map

```
src/
├── index.ts            Public API surface: the `Nazar` static class
├── client.ts            NazarClient: track(), captureException(), flush()
├── config.ts             Defaults, validation, env detection
├── types.ts               AIRequestEvent and all public types
├── transport.ts            HttpTransport: queue, batch, retry, backoff
├── middleware/
│   └── openai.ts               wrapOpenAI: the observer proxy
└── utils/
    ├── redact.ts                  Built-in + custom redaction
    ├── cost.ts                     Static pricing table → cost estimate
    ├── id.ts                        Event ID generation
    ├── backoff.ts                    Exponential backoff w/ jitter
    └── logger.ts                      Debug-gated internal logging
```

Dependency direction is strictly one-way:
`index.ts → client.ts → transport.ts → utils/*`, with `middleware/openai.ts`
depending only on `client.ts`'s public interface. No module reaches back
"up" the chain. This is what makes it possible to add
`middleware/anthropic.ts` or `middleware/gemini.ts` later without
touching `client.ts` or `transport.ts` at all.

## Why an observer, not a gateway

The most consequential decision in this codebase: **`wrapOpenAI` does not
intercept, replace, or route the request.** It returns a `Proxy` around
the real client. On `chat.completions.create`, it:

1. Calls the *original* method with the *original*, unmodified arguments.
2. Attaches `.then()`/`.catch()` observers to the returned promise (or a
   synchronous try/catch around the call itself).
3. Returns the *original* return value or rethrows the *original* error,
   completely unchanged.

Every other property on the client — `embeddings`, `apiKey`, whatever
ships in the underlying SDK next month — passes through the proxy
untouched, because the `get` trap only special-cases one dot-path
(`chat.completions.create`) and falls through to `Reflect.get` /
`.bind()` for everything else.

The alternative — a gateway client with its own call surface, e.g.
`nazar.ai.generate(...)` — was considered and deliberately deferred. A
gateway means asking a developer to rewrite working call sites and trust
a new library with the actual request path (retries, error shapes,
streaming semantics, rate limit handling) before they've gotten any
value from it. An observer means the value (dashboards, cost visibility,
error tracking) arrives before any trust is asked for. Given that this is
a brand-new open-source project, adoption is the binding constraint —
correctness and reversibility of a one-line wrap matters more than API
elegance right now.

The gateway is still the intended end state (see
[Where this goes next](#where-this-goes-next)) — it's sequenced to come
*after* the observer has established trust and default configuration
(pricing tables, redaction rules, batching behavior) that the gateway
can then reuse.

## The event model is provider-agnostic by construction

`AIRequestEvent.provider` and `.model` are `string`, not a union of known
provider names. This is intentional: adding Anthropic support should
never require a breaking change to `types.ts`, a major version bump, or
a schema migration on the ingestion side. The trade-off is you lose
compile-time exhaustiveness checks over providers — acceptable, since the
whole point of this field is to stay open-ended.

## Transport: why a hand-rolled queue instead of a logging library

The transport (`transport.ts`) intentionally does the minimum needed to
satisfy four constraints simultaneously:

- **Non-blocking**: `send()` pushes onto an in-memory array and returns.
  All I/O happens later, either on a timer (`flushInterval`) or when the
  queue crosses `batchSize`.
- **Batched**: one HTTP request per `batchSize` events, not one per
  event — this is the difference between "fine at 10 req/s" and
  "hammering the ingestion API at production LLM call volume."
- **Resilient to transient failure**: `deliverWithRetry` retries with
  exponential backoff + jitter (`utils/backoff.ts`) up to `maxRetries`,
  then calls the user's `onError` and moves on. It does not block
  subsequent batches waiting on a stuck one — each batch's retry loop is
  independent, chained only through `inFlight` to prevent concurrent
  `flush()` calls from racing each other over the same queue.
- **Never throws**: `onError` itself is wrapped in a try/catch
  (`safeOnError`) — a broken user-supplied callback can't crash the
  transport, which can't crash `track()`, which can't crash the host
  app. This "every layer catches its own errors" pattern repeats
  throughout the codebase rather than relying on one top-level try/catch,
  because a single global catch can't distinguish "safe to ignore" from
  "silently corrupting state."

`Transport` is an interface, not a concrete class, specifically so tests
(and eventually alternative transports — e.g. a batched gRPC transport,
or an Edge-runtime-compatible transport without `AbortController`
assumptions) can substitute an in-memory implementation without any
change to `client.ts`.

## Privacy model

Three independent knobs, composed in a fixed order:

```
capturePrompts / captureResponses   → gate whether prompt/response
                                        content is included AT ALL
        ↓ (if included)
redactSensitiveData                 → built-in regex-based scrubbing
                                        (emails, API keys, tokens, etc.)
        ↓
redact (custom function)             → user-supplied final pass
```

`capturePrompts`/`captureResponses` default to `false` — this is the
actual privacy boundary; redaction is a safety net for teams that opt
in, not a substitute for opting out. A custom `redact` that throws is
caught and the field is replaced with `[REDACTED]` rather than either
crashing or leaking the unredacted value — silent failure would be worse
than an obviously-redacted field.

## Where this goes next

The module boundaries above are chosen so each of these lands as an
additive change:

- **`middleware/anthropic.ts`, `middleware/gemini.ts`**: same observer
  pattern as `middleware/openai.ts`, same `AIRequestEvent` shape, new
  provider-specific pricing entries in `utils/cost.ts`.
- **Framework adapters** (LangChain callback handler, Vercel AI SDK
  middleware): thin translators from that framework's instrumentation
  hooks into `client.track()` — no changes to `client.ts` or
  `transport.ts` required, since `track()` is already the stable public
  contract.
- **The gateway layer** (`nazar.ai.generate()`): once there's
  confidence in the observability path, this becomes a new module that
  *uses* `NazarClient` for tracking but owns the actual request —
  enabling routing, caching, and cost-based model selection. It is
  additive: `wrapOpenAI` keeps working for teams that never adopt the
  gateway.
- **Evaluations**: consumes the same `AIRequestEvent` stream from the
  backend side; no SDK changes needed beyond, eventually, an optional
  `nazar.evaluate()` call for synchronous eval hooks.
- **Python SDK**: a separate package mirroring this event schema and
  transport contract (queue/batch/retry/never-throw), not a port of this
  TypeScript code.

## Testing strategy

Each module is tested in isolation with fakes rather than the real
network or a real OpenAI client:

- `transport.test.ts` stubs `global.fetch` and asserts on batching,
  retry counts, and backoff behavior without real timers or sockets.
- `wrap-openai.test.ts` uses a minimal fake shaped like the real OpenAI
  client and asserts, above all, that the wrapped client's return values
  and thrown errors are referentially the *same* objects the fake
  produced — the load-bearing guarantee of the observer pattern.
- `client.test.ts` uses an in-memory `Transport` implementation
  (`tests/helpers/memory-transport.ts`) so client logic (defaulting,
  redaction wiring, validation) is tested independently of delivery
  mechanics.

This mirrors the module boundaries: if a test needs to reach into two
layers to make an assertion, that's usually a sign the interface between
them is leaking a detail it shouldn't.
