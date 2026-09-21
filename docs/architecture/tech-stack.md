# Tech stack

**Single source of truth for pinned versions.**

## Runtime & tooling

| Tool | Version | Notes |
|------|---------|-------|
| Node | 24.x (see `.node-version`) | LTS |
| pnpm | 11.x | `packageManager` in root `package.json` |
| Turborepo | 2.10.x | Monorepo task runner |
| TypeScript | 6.x | Shared via workspace |
| Zod | 4.5.x | Session and config contracts |
| Vitest | 5.x | `@harshy/core` and `@harshy/sdk` |

## Libraries

| Layer | Choice | Version | Notes |
|------|---------|---------|-------|
| Expo (peer, Expo hosts) | Expo | **57.0.x** | Config plugin + Expo module in `@harshy/native` |
| React Native (peer) | 0.86.x | with Expo 57 | Do not disable New Architecture |
| React (peer) | 19.2.3 | Expo 57 pin | |
| Native engines | Kotlin + Swift `HarshyClient` + Expo Modules API | `packages/native` | |
| JS SDK | `@harshy/sdk` | workspace | Plug-and-play client |
| Analysis | `@harshy/core` | workspace | Pure TS, unit-tested |

## Pin policy

- Prefer the **latest stable** release compatible with the pinned SDK/runtime
- Never downgrade a library to stay on an older runtime or architecture
- Expo packages: `npx expo install --fix` first; if the SDK pin is known-broken or behind latest stable, bump and add `expo.install.exclude`
- No pre-releases unless explicitly required
