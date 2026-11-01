import { haversineM } from "./geo.js";
import type { LocationSample } from "./types.js";

/** Vehicle pack id. v1 only ships `generic`; later packs swap coefficients. */
export type EcoVehicleProfileId = "generic";

/**
 * Relative energy coefficients for a generic car (not liters).
 * Optimal = rolling + aero at `vEffMps` with zero accel waste over the same distance.
 */
export type EcoProfile = {
  id: EcoVehicleProfileId;
  /** Energy per meter of travel. */
  rolling: number;
  /** Multiplier on ∫ v³ dt (and on V_eff² · D for optimal). */
  aero: number;
  /** Multiplier on ∫ max(a, 0) · v dt. */
  accel: number;
  /** Efficient cruise (m/s) used for the optimal floor (~50 km/h). */
  vEffMps: number;
  /** Below this distance, no eco grade. */
  minDistanceM: number;
  /** Need at least this many scored segments. */
  minSegments: number;
};

export const GENERIC_CAR_ECO: EcoProfile = {
  id: "generic",
  rolling: 1,
  aero: 0.002,
  accel: 1.5,
  vEffMps: 50 / 3.6,
  minDistanceM: 50,
  minSegments: 1,
};

export type TripEcoEstimate = {
  ecoScore: number | null;
  ecoRatio: number | null;
  ecoEnergy: number | null;
  ecoOptimal: number | null;
  vehicleProfileId: EcoVehicleProfileId;
};

export type EcoSample = Pick<LocationSample, "t" | "lat" | "lon" | "speedMps">;

/** Map consumption ratio to 0–100. ratio 1 → 100, 2 → 50, 3 → 0. */
export function ecoScoreFromRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 100;
  }
  return Math.max(0, Math.min(100, Math.round((100 * (3 - ratio)) / 2)));
}

function speedOf(sample: EcoSample): number | null {
  const v = sample.speedMps;
  if (v == null || !Number.isFinite(v) || v < 0) {
    return null;
  }
  return v;
}

/**
 * Estimate relative fuel energy and eco score from a GPS path.
 * Does not use IMU. Does not affect driving-quality points/score.
 */
export function estimateTripEco(
  samples: readonly EcoSample[],
  options?: {
    distanceM?: number;
    profile?: EcoProfile;
  },
): TripEcoEstimate {
  const profile = options?.profile ?? GENERIC_CAR_ECO;
  const empty: TripEcoEstimate = {
    ecoScore: null,
    ecoRatio: null,
    ecoEnergy: null,
    ecoOptimal: null,
    vehicleProfileId: profile.id,
  };

  if (samples.length < 2) {
    return empty;
  }

  let energy = 0;
  let pathDistanceM = 0;
  let segments = 0;

  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1]!;
    const next = samples[i]!;
    const dtSec = (next.t - prev.t) / 1000;
    if (!Number.isFinite(dtSec) || dtSec < 0.05 || dtSec > 60) {
      continue;
    }

    const v0 = speedOf(prev);
    const v1 = speedOf(next);
    if (v0 == null && v1 == null) {
      continue;
    }

    const v =
      v0 != null && v1 != null ? (v0 + v1) / 2 : (v0 ?? v1)!;
    const stepM = haversineM(
      { lat: prev.lat, lon: prev.lon },
      { lat: next.lat, lon: next.lon },
    );
    if (!Number.isFinite(stepM) || stepM < 0) {
      continue;
    }
    // Prefer path length; fall back to v·dt when GPS jumps are rejected as 0.
    const dist = stepM > 0.05 ? stepM : Math.max(0, v * dtSec);
    if (dist <= 0 && v < 0.3) {
      continue;
    }

    let a = 0;
    if (v0 != null && v1 != null) {
      a = (v1 - v0) / dtSec;
      if (!Number.isFinite(a)) {
        a = 0;
      }
    }

    energy += profile.rolling * dist;
    energy += profile.aero * v * v * v * dtSec;
    energy += profile.accel * Math.max(a, 0) * v * dtSec;
    pathDistanceM += dist;
    segments += 1;
  }

  const distanceM =
    options?.distanceM != null && Number.isFinite(options.distanceM) && options.distanceM > 0
      ? options.distanceM
      : pathDistanceM;

  if (
    segments < profile.minSegments ||
    distanceM < profile.minDistanceM ||
    energy <= 0
  ) {
    return empty;
  }

  const vEff = profile.vEffMps;
  const optimal =
    profile.rolling * distanceM + profile.aero * vEff * vEff * distanceM;
  if (!(optimal > 0)) {
    return empty;
  }

  const ratio = energy / optimal;
  return {
    ecoScore: ecoScoreFromRatio(ratio),
    ecoRatio: ratio,
    ecoEnergy: energy,
    ecoOptimal: optimal,
    vehicleProfileId: profile.id,
  };
}
