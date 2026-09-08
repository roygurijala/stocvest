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

/** Minimum flex/height weight so flat movers still render legibly (0–1 scale). */
export const HEAT_RELATIVE_SIZE_MIN = 0.38;

/** Floor for max |delta| when computing relative tile sizes — avoids divide-by-zero on flat groups. */
export const HEAT_RELATIVE_SIZE_DELTA_FLOOR = 0.05;

/**
 * Relative tile weights within a peer group (0–1).
 * Larger weight = moved further from the group median (out- or under-performed peers).
 */
export function heatRelativeSizeWeights(
  pcts: readonly (number | null | undefined)[],
  median: number | null,
  opts?: { minWeight?: number }
): number[] {
  const minWeight = opts?.minWeight ?? HEAT_RELATIVE_SIZE_MIN;
  const deltas = pcts.map((pct) => {
    const d = heatVsGroupDelta(pct, median);
    return d == null ? 0 : Math.abs(d);
  });
  const maxDelta = Math.max(...deltas, HEAT_RELATIVE_SIZE_DELTA_FLOOR);
  return pcts.map((pct, i) => {
    if (pct == null) return minWeight * 0.72;
    return minWeight + (deltas[i]! / maxDelta) * (1 - minWeight);
  });
}

/** Map a relative weight to flex + height for a heat tile. */
export function heatRelativeTileLayout(weight: number): { flex: string; minHeight: number } {
  const w = Math.max(HEAT_RELATIVE_SIZE_MIN * 0.72, Math.min(1, weight));
  return {
    flex: `${w.toFixed(3)} 1 56px`,
    minHeight: Math.round(44 + w * 40)
  };
}

export const heatRelativeGridStyle = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "stretch",
  width: "100%"
} as const;
