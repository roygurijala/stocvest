/**
 * Heat grid — compare each symbol's move to its peer group (sector holdings or watchlist).
 */

/** Median of finite values; null when the group has no quotes. */
export function heatGroupMedian(values: readonly (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function heatVsGroupDelta(pct: number | null | undefined, median: number | null): number | null {
  if (pct == null || median == null || !Number.isFinite(pct) || !Number.isFinite(median)) return null;
  return pct - median;
}

/** Compact secondary label, e.g. "+0.4 vs grp" or "≈ grp". */
export function formatHeatVsGroup(delta: number | null | undefined): string | null {
  if (delta == null || !Number.isFinite(delta)) return null;
  if (Math.abs(delta) < 0.05) return "≈ grp";
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)} vs grp`;
}

/** Color intensity from absolute move; optional peer median shifts emphasis to relative strength. */
export function heatCellPctForColor(pct: number | null, vsGroupDelta: number | null): number | null {
  if (pct == null) return null;
  if (vsGroupDelta != null && Number.isFinite(vsGroupDelta)) return vsGroupDelta;
  return pct;
}
