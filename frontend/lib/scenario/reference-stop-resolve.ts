/**
 * Two-layer reference stop: session structure anchor + ATR floor, then min-width policy.
 *
 * Long: final = min(structural, entry − k×ATR) — wider (lower) stop wins.
 * Short: final = max(structural, entry + k×ATR).
 */

import { applyMinStopDistance } from "@/lib/scenario/scenario-stop-policy";
import type { ScenarioDirection } from "@/lib/scenario/types";
export type ReferenceStopPresetId = "continuation" | "dip" | "breakout";
export type ReferenceStopTradingMode = "day" | "swing";

export const REFERENCE_STOP_ATR_K_BY_PRESET: Record<ReferenceStopPresetId, number> = {
  dip: 0.75,
  continuation: 1.0,
  breakout: 1.25
};

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** ATR multiplier for structural + ATR merge (preset overrides mode). */
export function referenceStopAtrK(opts?: {
  tradingMode?: ReferenceStopTradingMode | null;
  preset?: ReferenceStopPresetId | null;
}): number {
  if (opts?.preset) return REFERENCE_STOP_ATR_K_BY_PRESET[opts.preset];
  if (opts?.tradingMode === "day") return 0.85;
  return 1.0;
}

export type StructuralStopAnchorInput = {
  direction: ScenarioDirection;
  sessionLow: number | null;
  sessionHigh: number | null;
  vwap: number | null;
  prevClose: number | null;
  last: number | null;
  swingLow?: number | null;
  swingHigh?: number | null;
  /** Support edge of the entry zone (when distinct from session low). */
  zoneLo?: number | null;
  /** Resistance edge of the entry zone (when distinct from session high). */
  zoneHi?: number | null;
};

const SUPPORT_STOP_BUFFER = 0.995;
const RESISTANCE_STOP_BUFFER = 1.005;

function collectBullishSupportBase(input: StructuralStopAnchorInput): number | null {
  const lows: number[] = [];
  if (input.sessionLow != null && input.sessionLow > 0) lows.push(input.sessionLow);
  if (input.swingLow != null && input.swingLow > 0) lows.push(input.swingLow);
  if (input.zoneLo != null && input.zoneLo > 0) lows.push(input.zoneLo);
  if (lows.length === 0) return null;
  return Math.min(...lows);
}

function collectBearishResistanceBase(input: StructuralStopAnchorInput): number | null {
  const highs: number[] = [];
  if (input.sessionHigh != null && input.sessionHigh > 0) highs.push(input.sessionHigh);
  if (input.swingHigh != null && input.swingHigh > 0) highs.push(input.swingHigh);
  if (input.zoneHi != null && input.zoneHi > 0) highs.push(input.zoneHi);
  if (highs.length === 0) return null;
  return Math.max(...highs);
}

/**
 * Session-anchored stop before ATR merge (matches composite long/short geometry cascade).
 *
 * Long stops sit below the lowest support (session / swing / zone), not at min(low, VWAP)
 * when VWAP is mid-range — that pattern clusters stops where liquidity hunts.
 */
export function resolveStructuralStopAnchor(input: StructuralStopAnchorInput): number | null {
  const { vwap, prevClose, last } = input;

  if (input.direction === "bullish") {
    const supportBase = collectBullishSupportBase(input);
    if (supportBase != null) {
      let stop = round4(supportBase * SUPPORT_STOP_BUFFER);
      if (vwap != null && vwap > 0 && vwap <= supportBase) {
        stop = round4(Math.min(stop, vwap * SUPPORT_STOP_BUFFER));
      }
      return stop;
    }
    if (vwap != null && vwap > 0) return round4(vwap * SUPPORT_STOP_BUFFER);
    if (prevClose != null && prevClose > 0) return round4(prevClose * 0.99);
    if (last != null && last > 0) return round4(last * 0.98);
    return null;
  }

  const resistanceBase = collectBearishResistanceBase(input);
  if (resistanceBase != null) {
    let stop = round4(resistanceBase * RESISTANCE_STOP_BUFFER);
    if (vwap != null && vwap > 0 && vwap >= resistanceBase) {
      stop = round4(Math.max(stop, vwap * RESISTANCE_STOP_BUFFER));
    }
    return stop;
  }
  if (vwap != null && vwap > 0) return round4(vwap * RESISTANCE_STOP_BUFFER);
  if (prevClose != null && prevClose > 0) return round4(prevClose * 1.01);
  if (last != null && last > 0) return round4(last * 1.02);
  return null;
}

export type MergedReferenceStopResult = {
  stop: number | null;
  structuralStop: number | null;
  atrStop: number | null;
  usedAtrFloor: boolean;
};

export function resolveMergedReferenceStop(args: {
  direction: ScenarioDirection;
  entry: number;
  structuralStop: number | null;
  atr: number | null;
  atrK: number;
}): MergedReferenceStopResult {
  const structural =
    args.structuralStop != null && Number.isFinite(args.structuralStop) && args.structuralStop > 0
      ? round4(args.structuralStop)
      : null;
  const entry = args.entry;
  if (!Number.isFinite(entry) || entry <= 0) {
    return { stop: structural, structuralStop: structural, atrStop: null, usedAtrFloor: false };
  }

  let atrStop: number | null = null;
  const atr = args.atr;
  const k = args.atrK;
  if (atr != null && Number.isFinite(atr) && atr > 0 && k > 0) {
    atrStop =
      args.direction === "bullish" ? round4(entry - k * atr) : round4(entry + k * atr);
  }

  let merged: number | null = structural;
  let usedAtrFloor = false;
  if (structural != null && atrStop != null) {
    if (args.direction === "bullish") {
      merged = round4(Math.min(structural, atrStop));
      usedAtrFloor = merged < structural - 1e-8;
    } else {
      merged = round4(Math.max(structural, atrStop));
      usedAtrFloor = merged > structural + 1e-8;
    }
  } else if (structural == null && atrStop != null) {
    merged = atrStop;
    usedAtrFloor = true;
  }

  if (merged == null) {
    return { stop: null, structuralStop: structural, atrStop, usedAtrFloor: false };
  }

  const stop = applyMinStopDistance(args.direction, entry, merged, atr);
  return { stop, structuralStop: structural, atrStop, usedAtrFloor };
}

export function formatMergedStopProvenance(
  baseLabel: string,
  opts: { atrK: number; usedAtrFloor: boolean }
): string {
  const base = baseLabel.trim() || "Structural stop";
  if (!opts.usedAtrFloor) return base;
  return `${base}; widened to ${opts.atrK}×ATR14 floor`;
}

export function longStopProvenanceLabel(input: StructuralStopAnchorInput): string {
  const supportBase = collectBullishSupportBase(input);
  const { vwap, prevClose, last } = input;
  if (supportBase != null) {
    const usesSwing =
      (input.swingLow != null && input.swingLow > 0 && input.swingLow <= supportBase + 1e-6) ||
      (input.zoneLo != null && input.zoneLo > 0 && input.zoneLo <= supportBase + 1e-6);
    return usesSwing
      ? "Below swing/support zone — structural buffer"
      : "Below session low — structural buffer";
  }
  if (vwap != null && vwap > 0) {
    return "Below VWAP — structural buffer";
  }
  if (prevClose != null && prevClose > 0) return "Below prior close (99% rule) — fallback";
  if (last != null && last > 0) return "Below last price (98% rule) — fallback";
  return "Structural stop — source unavailable";
}

export function shortStopProvenanceLabel(input: StructuralStopAnchorInput): string {
  const resistanceBase = collectBearishResistanceBase(input);
  const { vwap, prevClose, last } = input;
  if (resistanceBase != null) {
    const usesSwing =
      (input.swingHigh != null && input.swingHigh > 0 && input.swingHigh >= resistanceBase - 1e-6) ||
      (input.zoneHi != null && input.zoneHi > 0 && input.zoneHi >= resistanceBase - 1e-6);
    return usesSwing
      ? "Above swing/resistance zone — structural buffer"
      : "Above session high — structural buffer";
  }
  if (vwap != null && vwap > 0) {
    return "Above VWAP — structural buffer";
  }
  if (prevClose != null && prevClose > 0) return "Above prior close (101% rule) — fallback";
  if (last != null && last > 0) return "Above last price (102% rule) — fallback";
  return "Structural stop — source unavailable";
}
