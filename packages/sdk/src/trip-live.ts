import type { LiveMetrics } from "@harshy/core";

import type { TripLiveDisplayPayload } from "./types";

export function formatTripDurationMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Metric SI display strings for the trip notification / Live Activity. */
export function formatTripLiveDisplay(
  metrics: LiveMetrics,
  title: string,
): TripLiveDisplayPayload {
  const speed =
    metrics.speedKmh == null || Number.isNaN(metrics.speedKmh)
      ? "—"
      : `${Math.round(metrics.speedKmh)} km/h`;
  const km = metrics.distanceM / 1000;
  const distance = Number.isFinite(km) ? `${km < 10 ? km.toFixed(2) : km.toFixed(1)} km` : "—";
  return {
    title,
    score: Number.isFinite(metrics.score) ? String(Math.round(metrics.score)) : "—",
    speed,
    duration: formatTripDurationMs(metrics.durationMs),
    distance,
  };
}
