# Documentation index

Master registry for the Signumb SDK. Update this file when adding or changing a doc.

## Architecture

| Doc | Description |
|-----|-------------|
| [architecture/tech-stack.md](architecture/tech-stack.md) | Pinned dependency versions |
| [architecture/env.md](architecture/env.md) | Environment variables (names only) |
| [architecture/monorepo.md](architecture/monorepo.md) | Repo layout and data flow |
| [architecture/testing.md](architecture/testing.md) | Test suite |
| [architecture/sensors.md](architecture/sensors.md) | GPS/IMU capture and permissions |
| [../packages/sdk/README.md](../packages/sdk/README.md) | JavaScript host API |
| [../packages/native/README.md](../packages/native/README.md) | Native `HarshyClient` + Expo sensor bridge |

## Features

| Doc | Status | Description |
|-----|--------|-------------|
| [features/driving-sdk.md](features/driving-sdk.md) | in-progress | Plug-and-play driving quality SDK |
| [features/session-export.md](features/session-export.md) | in-progress | Local session JSON + upload adapter |
| [features/road-quality.md](features/road-quality.md) | shipped | Path measure of pavement roughness |
| [features/possible-impact.md](features/possible-impact.md) | shipped | Possible-impact heuristic (not a crash, not a score) |
| [features/phone-handheld.md](features/phone-handheld.md) | shipped | Phone picked up / held while moving (not a score) |
| [features/trip-live-display.md](features/trip-live-display.md) | shipped | Active-trip notification / Live Activity payload |
| [features/native-sdk.md](features/native-sdk.md) | shipped | Kotlin/Swift `HarshyClient` |
| [features/auto-trip.md](features/auto-trip.md) | in-progress | Automatic trip start/stop (not fully calibrated) |

See [features/README.md](features/README.md) for the feature doc template.
