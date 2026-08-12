---
name: ainazar
description: AI Nazar SDK (@lonare/ai-nazar-sdk) and dashboard reference. Use when instrumenting OpenAI, OpenRouter, Anthropic, or Gemini calls for observability — track() / captureException() API, the four provider wrappers, config options, the /v1/events ingestion contract, and common integration pitfalls.
origin: user
---

# AI Nazar Reference

AI Nazar is an open-source AI observability SDK + dashboard. It observes LLM API calls — cost, latency, tokens, errors, model — without changing how you call your provider. Think Sentry, but for AI requests instead of exceptions.

- SDK repo: https://github.com/harshalone/ai-nazar-sdk
- Dashboard repo (open source, self-hostable): https://github.com/harshalone/ai-nazar
- Hosted dashboard: https://www.ainazar.com
- npm package: `@lonare/ai-nazar-sdk`

## When to Activate

- Adding cost/latency/token/error tracking to code that calls OpenAI, OpenRouter, Anthropic, or Gemini
- Writing or reviewing `Nazar.init(...)` / `Nazar.wrapOpenAI(...)` / `nazar.track(...)` calls
- Debugging why events aren't showing up on an AI Nazar dashboard
- Self-hosting the `ai-nazar` dashboard or working on its ingestion route
- Modifying the SDK itself (`ai-nazar-sdk` repo)

---

## Installation

```bash
npm install @lonare/ai-nazar-sdk
```

**The package name is `@lonare/ai-nazar-sdk` (scoped).** Two other names exist on npm and are legacy/stale — never use them in new code:
- `ai-nazar-sdk` (unscoped) — a stale `0.1.0` snapshot, only has `wrapOpenAI`, missing `wrapOpenRouter`/`wrapAnthropic`/`wrapGemini`.
- `ai-nazar` (unscoped) — same stale `0.1.0` snapshot under a different name.

If you see either of those in a `package.json` or an `import` statement, it's a bug — replace with `@lonare/ai-nazar-sdk`.

`openai`, `@anthropic-ai/sdk`, and `@google/genai` are optional peer dependencies — install whichever ones you actually use. `wrapOpenRouter` reuses the `openai` package (OpenRouter's API is OpenAI-compatible), so it needs no separate dependency.

---

## Quick Start

```ts
import OpenAI from "openai";
import { Nazar } from "@lonare/ai-nazar-sdk";

// 1. Initialize once, at application startup.
const nazar = Nazar.init({
  apiKey: "nz_live_xxxxx", // from the dashboard's API Keys page
});

// 2. Wrap your provider client.
const openai = Nazar.wrapOpenAI(new OpenAI());

// 3. Call exactly as before — nothing else changes.
const completion = await openai.chat.completions.create({
  model: "gpt-5.5",
  messages: [{ role: "user", content: "Explain OAuth" }],
});
```

`wrapOpenAI` returns a transparent `Proxy`. Same responses, same errors, same streaming behavior — it does not replace, route, or gateway the request. It only observes `chat.completions.create` (or the provider-equivalent generation call) and reports what happened.

### All four provider wrappers

```ts
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { Nazar } from "@lonare/ai-nazar-sdk";

// OpenAI
const openai = Nazar.wrapOpenAI(new OpenAI());
await openai.chat.completions.create({ model: "gpt-5.5", messages });

// OpenRouter — OpenAI-compatible API, same `openai` package, different baseURL.
const openrouter = Nazar.wrapOpenRouter(
  new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
  }),
);
await openrouter.chat.completions.create({
  model: "anthropic/claude-sonnet-5", // vendor/model slug — tracked verbatim
  messages,
});

// Anthropic (Claude)
const anthropic = Nazar.wrapAnthropic(new Anthropic());
await anthropic.messages.create({ model: "claude-sonnet-5", max_tokens: 1024, messages });

// Google Gemini
const ai = Nazar.wrapGemini(new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
await ai.models.generateContent({ model: "gemini-2.0-flash", contents: "Explain OAuth" });
```

Each wrapper instruments only that provider's generation call (`chat.completions.create` for OpenAI/OpenRouter, `messages.create` for Anthropic, `models.generateContent`/`generateContentStream` for Gemini) — every other method and property on the client passes through untouched.

### Manual tracking (any provider, or a raw `fetch` call)

Use this when you're not going through an SDK client at all — e.g. a raw `fetch()` to OpenRouter's REST API, a custom provider, or wrapping the model-selection/fallback-chain logic around a call:

```ts
const start = Date.now();
try {
  const response = await myCustomProvider.generate(prompt);
  nazar.track({
    provider: "custom",       // or "openrouter", "openai", etc — plain string, not an enum
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

`track()` and `captureException()` **never throw** and **never block** — they enqueue and return immediately. A missing `provider` or `model` causes the event to be silently dropped with a console warning, not an exception.

---

## API

### `Nazar.init(options)`

Call once at startup. Returns a `NazarClient`. `apiKey` is the only required field.

| Option | Type | Default | Notes |
|---|---|---|---|
| `apiKey` | `string` | — | **Required.** |
| `endpoint` | `string` | `https://www.ainazar.com/api` | Override for self-hosting. See [Self-hosting endpoint](#self-hosting-endpoint) below. |
| `environment` | `string` | auto-detected from `NODE_ENV`/`VERCEL_ENV` | Free-form label. |
| `capturePrompts` | `boolean` | `false` | Opt-in — sends raw prompt content. |
| `captureResponses` | `boolean` | `false` | Opt-in — sends raw response content. |
| `redactSensitiveData` | `boolean` | `true` | Best-effort redaction (emails, API keys, bearer tokens, card numbers, SSNs, phone numbers) applied to anything captured. |
| `redact` | `(value) => value` | — | Custom redaction, layered on top of the built-in pass. |
| `maxQueueSize` | `number` | `1000` | Oldest events dropped on overflow. |
| `batchSize` | `number` | `20` | Events per delivery POST. |
| `flushInterval` | `number` | `5000` | ms between background flushes. |
| `maxRetries` | `number` | `3` | Retries per batch, exponential backoff w/ jitter. |
| `debug` | `boolean` | `false` | Logs internal activity to console, prefixed `[AI Nazar]`. |
| `enabled` | `boolean` | `true` | `false` makes every method a no-op. |
| `onError` | `(failure) => void` | — | Called when a batch exhausts retries. |

### `Nazar.wrapOpenAI(client, nazarClient?)` / `wrapOpenRouter` / `wrapAnthropic` / `wrapGemini`

Same contract across all four: pass the provider client in, get a transparent proxy back. Uses the singleton from `Nazar.init()` unless a specific `NazarClient` is passed as the second arg (useful for multi-tenant apps with per-request Nazar clients).

### `nazar.track(event)` / `nazar.captureException(error, context?)`

See Quick Start above. `AIRequestEvent.provider`/`.model` are plain strings, never an enum — new providers never require an SDK version bump.

### `nazar.flush()` / `nazar.shutdown()`

`flush()` drains the queue immediately — call before a short-lived process (serverless function, CLI, script) exits, or the in-memory queue may never get delivered. `shutdown()` flushes and stops the background timer — call on graceful shutdown of a long-running server.

---

## Data Model

```ts
interface AIRequestEvent {
  id?: string;          // client-generated, format "evt_<uuid>" — see UUID pitfall below
  provider: string;     // "openai" | "openrouter" | "anthropic" | "gemini" | "custom" | ...
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  latency?: number;     // ms
  cost?: number;        // USD
  status: "success" | "error";
  error?: { message: string; stack?: string; code?: string; statusCode?: number };
  environment?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}
```

---

## Ingestion Contract (`/v1/events`)

What the SDK's `HttpTransport` actually sends — relevant if you're debugging delivery, writing a compatible server, or self-hosting:

```
POST {endpoint}/v1/events
Authorization: Bearer <apiKey>
Content-Type: application/json
x-nazar-sdk: ai-nazar-js

{ "events": [ <AIRequestEvent>, ... ] }
```

- Batched (default 20/request), delivered on a background timer (default every 5s) or immediately when the queue hits `batchSize`.
- On non-2xx, retries the **same batch** (same event ids) up to `maxRetries` times with exponential backoff + jitter, then calls `onError` and drops it.
- Server should respond `202 { accepted: N, rejected: N }` on success (per the `ainazar.com`/`ai-nazar` reference implementation).

---

## Common Pitfalls

### 1. Wrong package name

`import { Nazar } from "ai-nazar"` or `"ai-nazar-sdk"` (unscoped) — see [Installation](#installation). These are stale `0.1.0` builds missing three of the four provider wrappers. Always use `@lonare/ai-nazar-sdk`.

### 2. `endpoint` pointing at a dead subdomain

SDK versions **before 0.2.1** defaulted `endpoint` to `https://api.ainazar.com` — a subdomain that was never provisioned (no DNS record). Every `track()` call would queue, then silently fail at DNS resolution, retry, and drop — with **zero visible error**, because `track()`/`captureException()` are designed to never throw into the host app. If a dashboard shows no events despite real traffic:

1. Check the installed SDK version — `npm ls @lonare/ai-nazar-sdk`. Upgrade to `>= 0.2.1`.
2. If pinned to an older version and can't upgrade immediately, pass `endpoint` explicitly: `Nazar.init({ apiKey, endpoint: "https://www.ainazar.com/api" })` (or your self-hosted origin + `/api` if using the Postbase/Postgres/SQLite dashboard variants — check whether your deployment mounts the ingest route under `/api` or at the root, since this varies by how the dashboard is deployed).
3. Enable `debug: true` on `Nazar.init()` and watch for `[AI Nazar] delivery attempt N failed: ...` in server logs — this is the fastest way to confirm whether delivery is actually failing vs. the event never being tracked in the first place.

### 3. Bare-domain redirects can drop the Authorization header

On the hosted dashboard, `https://ainazar.com/api/v1/events` (no `www`) 308-redirects to `https://www.ainazar.com/api/v1/events`. Some HTTP clients don't forward `Authorization` across a redirect. Always configure `endpoint` with the `www.` host directly to avoid the redirect entirely, rather than relying on redirect-following behavior.

### 4. Self-hosted dashboard: `events.id` column type varies by backend

The **hosted** `ainazar.com` dashboard's `events.id` is a strict `UUID PRIMARY KEY` column. The SDK's `generateId()` produces ids shaped like `evt_<uuid>` (prefixed for log readability) — **not a bare UUID**. A strict UUID column rejects that string outright, the insert throws, and the whole batch is reported as `500` with no further detail — which then gets retried (same invalid id) and dropped for good after `maxRetries`. This was a real bug, fixed server-side in `ainazar.com` by only forwarding the client id when it matches a bare-UUID pattern, otherwise letting the column default (`gen_random_uuid()`) generate one.

The **open-source** `ai-nazar` dashboard does not have this problem — its `events.id` column is `TEXT` (all three backend variants: Postgres/Prisma, SQLite/Prisma, and the Postbase schema), so the `evt_`-prefixed id stores fine as-is.

**If you're building a custom ingestion server against this SDK:** either store `event.id` as `TEXT`, or validate/strip the `evt_` prefix before writing to a `UUID` column — don't assume the client-supplied id is a bare UUID.

### 5. `flush()` in short-lived environments

If the host process can exit before the next background flush (`flushInterval`, default 5s) — a serverless function, a CLI script, a test run — call `await nazar.flush()` explicitly before the process/handler returns, or queued events are lost when the process dies. Long-running servers (typical `next start` / Express / Fastify processes) don't need this; the background timer eventually fires on its own.

### 6. Model chain / fallback logic — the SDK never invents a model name

If a dashboard shows an unexpected model (e.g. a Claude model when you expect a cheaper fallback), the SDK is not the place to look — it only reports whatever `model` string your own code passed to `track()` or whatever `model` field was in the request body the wrapped client sent. Check the model-selection/fallback-chain logic in the calling code (e.g. a `lonare_ai_models`-style priority table, or hardcoded fallback strings) before suspecting the SDK or dashboard.

---

## Privacy Defaults

`capturePrompts` and `captureResponses` both default to `false` — only metadata (tokens, latency, cost, model, status) is sent unless explicitly opted in. When capture is enabled, built-in redaction (emails, API keys, bearer tokens, card-shaped numbers, SSNs, phone numbers, and sensitive key names like `password`/`apiKey`/`secret`) runs before any custom `redact` function. A custom `redact` that throws drops the field and logs a warning rather than crashing the host app.

---

## Repos & Where Things Live

| What | Repo | Notes |
|---|---|---|
| SDK source | `harshalone/ai-nazar-sdk` | `src/index.ts` (public API) → `client.ts` → `transport.ts` → `utils/*`; `middleware/{openai,openrouter,anthropic,gemini}.ts` are thin provider adapters over `middleware/shared.ts`'s proxy core. |
| Hosted dashboard | `harshalone/ainazar.com` | Multi-user, auth required, deployed at ainazar.com. Ingest route: `src/app/api/v1/events/route.ts`. |
| Open-source dashboard | `harshalone/ai-nazar` | Self-hosted, no-login, SQLite/Postgres/Postbase backend options via Prisma. Ingest route: same `/api/v1/events` contract. |
| npm package | `@lonare/ai-nazar-sdk` | Published via tag-triggered GitHub Actions release (`v*.*.*` tag → lint/typecheck/test/build/publish). |

When fixing a bug found on one dashboard, check whether the other dashboard's schema/code has the same defect before assuming a shared fix applies — see pitfall #4 above for a concrete example where it didn't.
