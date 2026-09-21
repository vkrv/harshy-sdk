# Monorepo layout

```
/
├── packages/
│   ├── core/                # Detector, scoring, Zod session schema
│   ├── native/              # Kotlin/Swift HarshyClient + engines + Expo module
│   ├── sdk/                 # createHarshy() JS API + history archive
│   └── config/              # ESLint + TypeScript (@harshy/config)
├── docs/
├── AGENTS.md
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## Data flow

```
Phone sensors (HarshyEngine)
        │
        ├──────────────► Native apps: HarshyClient (Kotlin/Swift detector + session JSON)
        │
        ▼
@harshy/native  ──samples──►  @harshy/sdk  ──►  @harshy/core (events, score)
        │                         │
        │                         ▼
        │                    Session JSON (local)
        │                         │
        │                         ▼
        │                    UploadAdapter (optional, host-owned)
```

Host Expo/React Native apps depend on **both** `@harshy/sdk` and `@harshy/native` so autolinking can see the module. The JS host API is `@harshy/sdk`. Native Android/iOS apps use `HarshyClient` (see [`packages/native/README.md`](../../packages/native/README.md)). Do not run `HarshyClient` and the Expo module in the same process. `@harshy/core` is canonical detector math — native ports must match it; do not copy the detector into a host app.

## Adding packages

1. Create under `packages/*`
2. Depend on `@harshy/config` for ESLint/TS bases
3. Update `AGENTS.md` and [INDEX.md](../INDEX.md)
