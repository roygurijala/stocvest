/**
 * Direction-aware scenario geometry validation (entry / stop / target).
 */

export type ScenarioDirection = "bullish" | "bearish";

export function scenarioGeometryError(
  direction: ScenarioDirection,
  entry: number,
  stop: number,
  _target: number
): string | null {
  if (!Number.isFinite(entry) || !Number.isFinite(stop)) return null;

  if (direction === "bullish" && stop >= entry) {
    return `Entry is below stop level. For a long trade, entry must be above stop. Adjust entry above ${stop.toFixed(2)} or recalculate stop based on your entry.`;
  }
  if (direction === "bearish" && stop <= entry) {
    return `Entry is above stop level. For a short trade, entry must be below stop. Adjust entry below ${stop.toFixed(2)} or recalculate stop based on your entry.`;
  }
  return null;
}

export function directionalRiskPerShare(
  direction: ScenarioDirection,
  entry: number,
  stop: number
): number {
  if (!Number.isFinite(entry) || !Number.isFinite(stop)) return Number.NaN;
  if (direction === "bullish") {
    if (stop >= entry) return Number.NaN;
    return entry - stop;
  }
  if (stop <= entry) return Number.NaN;
  return stop - entry;
}

export function directionalRewardPerShare(
  direction: ScenarioDirection,
  entry: number,
  target: number
): number {
  if (!Number.isFinite(entry) || !Number.isFinite(target)) return Number.NaN;
  if (direction === "bullish") {
    if (target <= entry) return Number.NaN;
    return target - entry;
  }
  if (target >= entry) return Number.NaN;
  return entry - target;
}
