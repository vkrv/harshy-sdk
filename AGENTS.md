# Signumb SDK

On-device driving quality analysis SDK (Android + iOS). Phone-only sensing. Source packages remain `@harshy/*` (`createHarshy`, `HarshyClient`).

This repository is the **reusable host SDK**. It must not describe or depend on any specific consumer app.

## Packages

| Path | Purpose |
|------|---------|
| `packages/sdk` | JavaScript host API (`createHarshy`, optional `historyStore`) |
| `packages/native` | Kotlin/Swift `HarshyClient` + GPS/IMU engines + Expo bridge |
| `packages/core` | Detector, scoring, session schema |
| `packages/config` | Shared ESLint + TypeScript config |

## Documentation

- [docs/INDEX.md](docs/INDEX.md) — doc registry
- [packages/sdk/README.md](packages/sdk/README.md) — JS host integration
- [packages/native/README.md](packages/native/README.md) — native Android/iOS `HarshyClient`
- [docs/architecture/tech-stack.md](docs/architecture/tech-stack.md) — pinned versions

## Commands

```bash
pnpm install
pnpm check      # build + typecheck + lint + test
pnpm test       # includes native Android JUnit (+ Swift HarshyMath on macOS)
```

## Conventions

- `@harshy/core` is the canonical detector. Do not copy pulse / scoring math into a host.
- Host Expo/RN apps depend on **both** `@harshy/sdk` and `@harshy/native`.
- Native Android/iOS apps use `HarshyClient`. Do not construct it in the same process as the Expo module.
- `requestPermissions()` must not start capture. Trip GPS+IMU start in `start()` and stop in `stop()`.
- Default `createHarshy()` is **manual**. `arm()` / `disarm()` are opt-in auto-trip.
- `setUploadAdapter()` is optional. Nothing is uploaded until a host provides an adapter.
- Pass `liveDisplayTitle` from the host app name. The SDK fallback is **Signumb**.
- Docs and comments in this repo stay host-agnostic: no consumer app names, screens, or bundle IDs.

## Environment

The SDK is local-first. No server secrets are required. Hosts that attach an `UploadAdapter` own their own env vars. See [docs/architecture/env.md](docs/architecture/env.md).
