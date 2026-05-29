/**
 * Stop placement policy — min width, entry-linked suggestions, geometry fixes.
 *
 * Prevents tight/noise stops and invalid long geometry when the user moves entry
 * away from the system reference stop (e.g. dip entry with breakout-style stop).
 */

import type { ScenarioDirection } from "@/lib/scenario/types";

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Minimum risk distance in USD by price tier (AMZN rule: avoid sub-$1 noise stops). */
export function minStopDistanceUsd(entry: number, atr?: number | null): number {
  if (!Number.isFinite(entry) || entry <= 0) return 0.1;
  const atrFloor = atr != null && Number.isFinite(atr) && atr > 0 ? atr * 0.5 : 0;
  let priceFloor: number;
  if (entry >= 200) priceFloor = 1.25;
  else if (entry >= 50) priceFloor = 0.75;
  else if (entry >= 10) priceFloor = 0.35;
  else priceFloor = Math.max(0.08, entry * 0.025);
  return Math.max(atrFloor, priceFloor);
}

/** Widen stop so per-share risk is at least the tier minimum. */
export function applyMinStopDistance(
  direction: ScenarioDirection,
  entry: number,
  stop: number,
  atr?: number | null
): number {
  if (!Number.isFinite(entry) || !Number.isFinite(stop)) return stop;
  const minDist = minStopDistanceUsd(entry, atr);
  if (direction === "bullish") {
    if (stop >= entry) return round4(entry - minDist);
    if (entry - stop < minDist) return round4(entry - minDist);
    return round4(stop);
  }
  if (stop <= entry) return round4(entry + minDist);
  if (stop - entry < minDist) return round4(entry + minDist);
  return round4(stop);
}

export function isLongGeometryInvalid(entry: number, stop: number): boolean {
  return Number.isFinite(entry) && Number.isFinite(stop) && stop >= entry;
}

export function isShortGeometryInvalid(entry: number, stop: number): boolean {
  return Number.isFinite(entry) && Number.isFinite(stop) && stop <= entry;
}

export type StopSuggestionInput = {
  direction: ScenarioDirection;
  entry: number;
  structuralStop: number | null;
  zoneLo: number | null;
  zoneHi: number | null;
  atr: number | null;
};

/**
 * Suggest a stop below (long) or above (short) entry using structure + min distance.
 */
export function suggestStopForEntry(input: StopSuggestionInput): number | null {
  const { direction, entry, structuralStop, zoneLo, zoneHi, atr } = input;
  if (!Number.isFinite(entry) || entry <= 0) return null;

  if (direction === "bullish") {
    const underZone =
      zoneLo != null && zoneLo > 0 && zoneLo < entry ? round4(zoneLo * 0.998) : null;
    const structural =
      structuralStop != null && structuralStop > 0 && structuralStop < entry
        ? round4(structuralStop)
        : null;
    let candidate = underZone != null && structural != null
      ? Math.min(underZone, structural)
      : underZone ?? structural;
    if (candidate == null || candidate >= entry) {
      candidate = round4(entry - minStopDistanceUsd(entry, atr));
    }
    return applyMinStopDistance("bullish", entry, candidate, atr);
  }

  const aboveZone =
    zoneHi != null && zoneHi > 0 && zoneHi > entry ? round4(zoneHi * 1.002) : null;
  const structural =
    structuralStop != null && structuralStop > entry ? round4(structuralStop) : null;
  let candidate = aboveZone != null && structural != null
    ? Math.max(aboveZone, structural)
    : aboveZone ?? structural;
  if (candidate == null || candidate <= entry) {
    candidate = round4(entry + minStopDistanceUsd(entry, atr));
  }
  return applyMinStopDistance("bearish", entry, candidate, atr);
}

export type EntryEdgeQuality = "support" | "breakout" | "mid_range" | "unknown";

/** Prefer swing range when it spans more than today's session zone (edge classification). */
export function effectiveEntryZoneForClassification(args: {
  sessionLo: number | null;
  sessionHi: number | null;
  swingLo: number | null;
  swingHi: number | null;
}): { lo: number | null; hi: number | null } {
  const { sessionLo, sessionHi, swingLo, swingHi } = args;
  const sessionSpan =
    sessionLo != null &&
    sessionHi != null &&
    Number.isFinite(sessionLo) &&
    Number.isFinite(sessionHi) &&
    sessionHi > sessionLo
      ? sessionHi - sessionLo
      : 0;
  const swingSpan =
    swingLo != null &&
    swingHi != null &&
    Number.isFinite(swingLo) &&
    Number.isFinite(swingHi) &&
    swingHi > swingLo
      ? swingHi - swingLo
      : 0;
  if (swingSpan > sessionSpan + 1e-6) {
    return { lo: swingLo, hi: swingHi };
  }
  return { lo: sessionLo, hi: sessionHi };
}

/** Classify entry location within the reference zone for UI hints. */
export function classifyEntryEdge(
  entry: number,
  zoneLo: number | null,
  zoneHi: number | null
): EntryEdgeQuality {
  if (
    zoneLo == null ||
    zoneHi == null ||
    !Number.isFinite(zoneLo) ||
    !Number.isFinite(zoneHi) ||
    zoneHi <= zoneLo
  ) {
    return "unknown";
  }
  const span = zoneHi - zoneLo;
  const pos = (entry - zoneLo) / span;
  if (pos <= 0.25) return "support";
  if (pos >= 0.75) return "breakout";
  return "mid_range";
}

export function entryEdgeHint(quality: EntryEdgeQuality): string | null {
  switch (quality) {
    case "mid_range":
      return "Mid-range entry — lower historical edge; consider Dip (support) or Breakout presets.";
    case "support":
      return "Entry near support edge — higher-probability dip style.";
    case "breakout":
      return "Entry near resistance edge — momentum / breakout style.";
    default:
      return null;
  }
}
