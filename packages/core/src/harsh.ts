import type { DetectorConfig, HarshEventLevel, HarshLevel } from "./types.js";

export type { HarshEventLevel, HarshLevel };

export const HARSH_LEVELS = ["norm", "light", "medium", "heavy"] as const satisfies readonly HarshLevel[];

export const DEFAULT_HARSH_MEDIUM_X = 1.5;
export const DEFAULT_HARSH_HEAVY_X = 2;

export function harshLevelRank(level: HarshLevel): number {
  if (level === "norm") {
    return 0;
  }
  if (level === "light") {
    return 1;
  }
  if (level === "medium") {
    return 2;
  }
  return 3;
}

/** Classify |peak| against a threshold. Below the threshold is within norm. */
export function harshLevel(
  peak: number,
  threshold: number,
  mediumX = DEFAULT_HARSH_MEDIUM_X,
  heavyX = DEFAULT_HARSH_HEAVY_X,
): HarshLevel {
  if (!(peak > 0) || threshold <= 0 || peak < threshold) {
    return "norm";
  }
  const ratio = peak / threshold;
  if (ratio >= heavyX) {
    return "heavy";
  }
  if (ratio >= mediumX) {
    return "medium";
  }
  return "light";
}

export function harshEventLevel(
  peak: number,
  threshold: number,
  mediumX = DEFAULT_HARSH_MEDIUM_X,
  heavyX = DEFAULT_HARSH_HEAVY_X,
): HarshEventLevel {
  const level = harshLevel(peak, threshold, mediumX, heavyX);
  return level === "norm" ? "light" : level;
}

export function harshLevelLabel(level: HarshLevel): string {
  if (level === "norm") {
    return "Within norm";
  }
  if (level === "light") {
    return "Light";
  }
  if (level === "medium") {
    return "Medium";
  }
  return "Heavy";
}

/** Longitudinal g is one signed axis: accel and brake cannot both be harsh. */
export function longitudinalHarshLevel(
  accelLevel: HarshLevel,
  brakeLevel: HarshLevel,
): HarshLevel {
  return harshLevelRank(accelLevel) >= harshLevelRank(brakeLevel) ? accelLevel : brakeLevel;
}

/** |Δω|/Δt between consecutive GPS yaw samples (rad/s²). */
export function yawRateJerkRadps2(
  yawRateRadps: number,
  t: number,
  previousYawRateRadps: number | null,
  previousT: number | null,
  maxDtSec = 8,
): number | null {
  if (previousYawRateRadps == null || previousT == null) {
    return null;
  }
  const dtSec = (t - previousT) / 1000;
  if (!(dtSec > 0) || dtSec > maxDtSec) {
    return null;
  }
  return Math.abs(yawRateRadps - previousYawRateRadps) / dtSec;
}

/**
 * Sudden heading-rate spike while moving fast enough — not a steady low-speed turn.
 * Call when yaw has just fallen after a brief elevated peak (see detector elevation state).
 */
export function isSwerveMotion(input: {
  speedMps: number | null;
  cornering: boolean;
  peakYawRadps: number | null;
  riseJerkRadps2: number | null;
  elevatedMs: number | null;
  config: Pick<
    DetectorConfig,
    | "harshSwerveRadps"
    | "harshSwerveJerkRadps2"
    | "swerveMinSpeedMps"
    | "swerveMaxElevatedMs"
  >;
}): boolean {
  const { speedMps, cornering, peakYawRadps, riseJerkRadps2, elevatedMs, config } = input;
  return (
    speedMps != null &&
    speedMps >= config.swerveMinSpeedMps &&
    !cornering &&
    peakYawRadps != null &&
    peakYawRadps >= config.harshSwerveRadps &&
    riseJerkRadps2 != null &&
    riseJerkRadps2 >= config.harshSwerveJerkRadps2 &&
    elevatedMs != null &&
    elevatedMs > 0 &&
    elevatedMs <= config.swerveMaxElevatedMs
  );
}

export function liveHarshLevels(input: {
  moving: boolean;
  longitudinal: number | null;
  lateral: number | null;
  yawRateRadps: number | null;
  config: Pick<
    DetectorConfig,
    | "harshAccelMps2"
    | "harshBrakeMps2"
    | "harshCornerMps2"
    | "harshSwerveRadps"
    | "harshMediumX"
    | "harshHeavyX"
  >;
}): {
  accelLevel: HarshLevel;
  brakeLevel: HarshLevel;
  cornerLevel: HarshLevel;
  swerveLevel: HarshLevel;
} {
  if (!input.moving) {
    return { accelLevel: "norm", brakeLevel: "norm", cornerLevel: "norm", swerveLevel: "norm" };
  }
  const { longitudinal: long, lateral: lat, yawRateRadps: yaw, config } = input;
  const accelPeak = long != null && long > 0 ? long : 0;
  const brakePeak = long != null && long < 0 ? -long : 0;
  const cornerPeak = lat == null ? 0 : Math.abs(lat);
  const swervePeak = yaw == null ? 0 : Math.abs(yaw);
  return {
    accelLevel: harshLevel(accelPeak, config.harshAccelMps2, config.harshMediumX, config.harshHeavyX),
    brakeLevel: harshLevel(brakePeak, config.harshBrakeMps2, config.harshMediumX, config.harshHeavyX),
    cornerLevel: harshLevel(
      cornerPeak,
      config.harshCornerMps2,
      config.harshMediumX,
      config.harshHeavyX,
    ),
    swerveLevel: harshLevel(
      swervePeak,
      config.harshSwerveRadps,
      config.harshMediumX,
      config.harshHeavyX,
    ),
  };
}
