<p align="center">
  <img src="./assets/images/nazar-logo-bg-transparent.png" alt="AI Nazar logo" width="200" />
</p>

<h1 align="center">AI Nazar</h1>

<p align="center">
  <a href="https://github.com/harshalone/ai-nazar-sdk/actions/workflows/ci.yml"><img src="https://github.com/harshalone/ai-nazar-sdk/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/harshalone/ai-nazar-sdk" alt="License"></a>
  <a href="https://www.npmjs.com/package/ai-nazar"><img src="https://img.shields.io/npm/v/ai-nazar" alt="npm version"></a>
  <a href="https://github.com/harshalone/ai-nazar-sdk/stargazers"><img src="https://img.shields.io/github/stars/harshalone/ai-nazar-sdk?style=flat" alt="GitHub stars"></a>
</p>

**Open-source AI observability for LLM applications.** Track cost, latency,
tokens, errors, and model usage — without changing how you call your AI
provider.

<p align="center">
  <a href="#why-ai-nazar">Why AI Nazar</a> •
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick start</a> •
  <a href="#api">API</a> •
  <a href="#data-model">Data model</a> •
  <a href="#privacy">Privacy</a> •
  <a href="#roadmap">Roadmap</a> •
  <a href="#contributing">Contributing</a>
</p>

The [dashboard](https://github.com/harshalone/ai-nazar) is the companion
app that visualizes what this SDK sends — cost, latency, tokens, and
errors, in real time, with no login required. **[Live demo →](https://ainazar.com)**

```ts
import OpenAI from "openai";
import { Nazar } from "ai-nazar";

const nazar = Nazar.init({ apiKey: "nz_live_xxxxx" });
const openai = Nazar.wrapOpenAI(new OpenAI());

// Nothing else changes. Every call is now observed.
const completion = await openai.chat.completions.create({
  model: "gpt-5.5",
  messages: [{ role: "user", content: "Explain OAuth" }],
});
```

## Why AI Nazar

If you've used [Sentry](https://sentry.io) for error tracking, AI Nazar
will feel familiar — except instead of exceptions, it observes your AI
requests: which model was called, how many tokens it used, how long it
took, what it cost, and whether it failed.

**AI Nazar is an observer, not a replacement client.** The first version
intentionally does *not* introduce a new way to call your AI provider.
Your existing `openai.chat.completions.create(...)` calls keep working
exactly as they do today — same responses, same errors, same streaming
behavior. AI Nazar just watches.

This is a deliberate adoption strategy: production code that already
works is the code developers are most reluctant to touch. A wrapper you
can add in one line, with a guarantee that behavior is unchanged, is the
version of this SDK most likely to actually get installed. Routing,
caching, and gateway features (see [Roadmap](#roadmap)) come later, once
there's a reason to trust AI Nazar with the request path itself.

## Installation

```bash
npm install ai-nazar
# or
pnpm add ai-nazar
# or
yarn add ai-nazar
```

`openai` is an optional peer dependency — install it if you're using
`wrapOpenAI`. AI Nazar works fine without it if you're only calling
`track()` / `captureException()` manually.

## Quick start

### 1. Initialize once, at application startup

```ts
import { Nazar } from "ai-nazar";

const nazar = Nazar.init({
  apiKey: "nz_live_xxxxx",
  environment: "production", // or omit to auto-detect from NODE_ENV
});
```

### 2. Wrap your OpenAI client

```ts
import OpenAI from "openai";
import { Nazar } from "ai-nazar";

const openai = Nazar.wrapOpenAI(new OpenAI());
```

Every `chat.completions.create(...)` call made through `openai` is now
automatically tracked: provider, model, duration, token usage, estimated
cost, and errors — with **no other code changes required**.

### 3. Or track manually, for any provider

```ts
const start = Date.now();
try {
  const response = await myCustomProvider.generate(prompt);
  nazar.track({
    provider: "custom",
    model: "my-model-v1",
    inputTokens: response.usage.input,
    outputTokens: response.usage.output,
    latency: Date.now() - start,
    cost: 0.0021,
  });
} catch (error) {
  nazar.captureException(error, { provider: "custom", model: "my-model-v1" });
  throw error;
}
```

## API

### `Nazar.init(options)`

Initializes the SDK and returns a `NazarClient`. Call once at startup.
`apiKey` is the only required field.

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | — | **Required.** Your AI Nazar API key. |
| `endpoint` | `string` | `https://api.ainazar.com` | API base URL. Override for self-hosting or testing. |
| `environment` | `string` | auto-detected from `NODE_ENV` | Free-form environment label (`"production"`, `"staging"`, …). |
| `capturePrompts` | `boolean` | `false` | Capture raw prompt content on events. |
| `captureResponses` | `boolean` | `false` | Capture raw response content on events. |
| `redactSensitiveData` | `boolean` | `true` | Best-effort redaction of emails, API keys, tokens, etc. in captured content. |
| `redact` | `(value: unknown) => unknown` | — | Custom redaction function, applied after built-in redaction. |
| `maxQueueSize` | `number` | `1000` | Max events buffered in memory; oldest are dropped on overflow. |
| `batchSize` | `number` | `20` | Events per delivery batch. |
| `flushInterval` | `number` | `5000` | Milliseconds between automatic background flushes. |
| `maxRetries` | `number` | `3` | Retry attempts per batch on delivery failure. |
| `debug` | `boolean` | `false` | Verbose internal logging. |
| `enabled` | `boolean` | `true` | Set `false` to fully disable the SDK (all calls become no-ops). |
| `onError` | `(failure) => void` | — | Called when a batch fails to deliver (including after retries are exhausted). |

### `Nazar.wrapOpenAI(openaiClient, client?)`

Returns a transparent proxy around an OpenAI client instance. Instruments
`chat.completions.create`; every other property and method passes through
untouched. Uses the singleton from `Nazar.init()` unless a specific
`NazarClient` is passed as the second argument.

### `nazar.track(event)`

Record a single AI request observation.

```ts
nazar.track({
  provider: "openai",
  model: "gpt-5.5",
  inputTokens: 1200,
  outputTokens: 400,
  latency: 850,
  cost: 0.04,
  requestId: "abc123",
});
```

`track()` never throws and never blocks — it enqueues the event and
returns immediately. Missing `provider`/`model` causes the event to be
dropped with a warning, never an exception.

### `nazar.captureException(error, context?)`

Record an error encountered while calling an AI provider.

```ts
nazar.captureException(error, {
  model: "gpt-5.5",
  provider: "openai",
});
```

### `nazar.flush()` / `nazar.shutdown()`

`flush()` drains the local queue immediately — call it before a
short-lived process (e.g. a serverless function or CLI) exits. `shutdown()`
flushes and stops background timers; call it on graceful shutdown.

## Data model

```ts
interface AIRequestEvent {
  id?: string;
  provider: string; // "openai", "anthropic", "custom", ...
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  latency?: number; // ms
  cost?: number; // USD
  status: "success" | "error";
  error?: { message: string; stack?: string; code?: string; statusCode?: number };
  environment?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}
```

`provider` and `model` are plain strings, not enums — new providers never
require a breaking change to this package.

## Privacy

AI Nazar is **privacy-first by default**: `capturePrompts` and
`captureResponses` both default to `false`. Only metadata (tokens,
latency, cost, model, status) is sent unless you explicitly opt in.

```ts
Nazar.init({
  apiKey: "nz_live_xxxxx",
  capturePrompts: false, // never send prompt content (default)
  captureResponses: false, // never send response content (default)
  redactSensitiveData: true, // scrub emails/keys/tokens from anything you do capture
  redact: (value) => myCompanyRedactionPolicy(value), // your own rules, layered on top
});
```

If you do enable capture, built-in redaction runs first (emails, API
keys, bearer tokens, credit-card-shaped numbers, SSNs, and common
sensitive key names like `password`/`apiKey`/`secret`), followed by your
custom `redact` function if provided. A custom `redact` that throws never
crashes your app — the field is dropped and logged instead.

## Transport & reliability

Events are queued in memory and delivered in the background:

```
AI Request
     |
Application continues (no blocking)
     |
Background queue  →  batched  →  AI Nazar API
                       ↑
                 retry w/ backoff
                 on failure
```

- **Never slows down your AI requests.** `track()` is synchronous and
  non-blocking; all network I/O happens on a background timer or on
  explicit `flush()`.
- **Batches** events (default: 20 per request) instead of firing one
  request per event.
- **Retries** failed batches with exponential backoff (default: 3
  attempts).
- **Handles offline mode** gracefully — failed batches are retried;
  if retries are exhausted, `onError` fires and the SDK moves on rather
  than blocking or crashing.
- **Bounded memory.** If the queue grows past `maxQueueSize`, the oldest
  events are dropped (with a warning) rather than growing unbounded.
- **Never throws into your application.** Every public method
  (`track`, `captureException`, `flush`, `shutdown`) catches its own
  errors internally.

## Debug mode

```ts
Nazar.init({ apiKey: "nz_live_xxxxx", debug: true });
```

Logs internal SDK activity (queueing, batching, retries) to the console,
prefixed with `[AI Nazar]`.

## Roadmap

This first release is intentionally the smallest useful foundation. It's
built so the following can be layered on without breaking changes:

- **More providers**: Anthropic, Gemini, and others via the same
  observer pattern (`Nazar.wrapAnthropic`, etc.), sharing the
  provider-agnostic `AIRequestEvent` model.
- **Framework integrations**: LangChain, Vercel AI SDK.
- **A gateway layer** (`nazar.ai.generate()`): once there's adoption and
  trust in the observability path, an opt-in unified call surface for
  routing, caching, and cost optimization across providers — additive,
  not a replacement for direct provider calls.
- **Evaluations**: quality scoring on top of collected request data.
- **Python SDK**: mirroring this data model and transport design.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the design rationale behind
the observer pattern, the transport layer, and how this is meant to
evolve toward provider expansion and a gateway layer.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for
local setup, the check suite, and the release process. Please run the
full check suite before submitting:

```bash
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

## License

[MIT](./LICENSE)
