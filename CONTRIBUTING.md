# Contributing to AI Nazar SDK

Thanks for considering a contribution — this guide covers local setup,
the check suite, and how a release gets published.

## Local setup

```bash
git clone https://github.com/harshalone/ai-nazar-sdk.git
cd ai-nazar-sdk
npm install
```

## Project structure

Read [ARCHITECTURE.md](./ARCHITECTURE.md) first — it explains the design
goals (non-blocking, adoption-friction-near-zero, privacy-by-default,
provider-agnostic) and the module map. In short:

- `src/index.ts` — public API surface (`Nazar` static class).
- `src/client.ts` — `NazarClient`: `track()`, `captureException()`, `flush()`.
- `src/transport.ts` — `HttpTransport`: in-memory queue, batching, retry
  with backoff.
- `src/middleware/openai.ts` — `wrapOpenAI`, the observer proxy.
- `src/utils/` — cost estimation, redaction, backoff, id generation, logging.
- `src/types.ts` — `AIRequestEvent` and all public types.

Every public method must be non-blocking and must never throw into the
host application — that constraint applies to any change in `client.ts`,
`transport.ts`, or `middleware/`.

## Before opening a PR

Run the full check suite — this is exactly what CI runs on every PR:

```bash
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

All four must pass. Coverage currently sits around 93% statements — new
code in `src/` should come with tests in `tests/` (mirroring the file
being tested, e.g. `src/transport.ts` → `tests/transport.test.ts`).
`tests/helpers/memory-transport.ts` is available for tests that need a
fake transport instead of hitting the network.

## Adding a new provider integration

If you're adding a `wrapAnthropic` or similar (see the
[Roadmap](./README.md#roadmap)), follow the pattern in
`src/middleware/openai.ts`: a transparent proxy that instruments the
relevant call and passes everything else through untouched, sharing the
provider-agnostic `AIRequestEvent` model in `src/types.ts` rather than
introducing provider-specific event shapes.

## Pull request workflow

1. Fork the repo and create a branch off `main`.
2. Keep PRs focused — one logical change per PR.
3. Make sure the full check suite (above) passes.
4. Open the PR against `main` with a clear description of what changed
   and why. Link any related issue.
5. A maintainer will review and may ask for changes.

## Release process (maintainers)

Releases are tag-triggered via `.github/workflows/release.yml`:

1. Bump `version` in `package.json` (semver).
2. Commit the version bump.
3. Tag and push:
   ```bash
   git tag v<version>   # must exactly match package.json's version
   git push origin v<version>
   ```
4. CI re-runs the full check suite, verifies the tag matches
   `package.json`, builds, and publishes to npm with provenance. A
   GitHub release is created automatically with generated release notes.

Publishing requires the `NPM_TOKEN` repo secret (an npm **Automation**
token) to be configured — see repo Settings → Secrets and variables →
Actions.

## Reporting bugs / requesting features

Use the issue templates — they ask for the information usually needed
to act on a report (repro steps, SDK version, expected vs. actual
behavior).
