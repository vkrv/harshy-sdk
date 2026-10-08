/**
 * Monotonic Harshy SDK stamp written on every new `SessionExport`.
 * Bump by 1 on every intentional SDK behavior or export-shape change
 * (detector, scoring, auto-trip, native parity). Not semver and not
 * `schemaVersion` (that stays 1 for additive JSON). Older files omit
 * `sdkVersion` — treat as unknown.
 */
export const HARSHY_SDK_VERSION = 8;
