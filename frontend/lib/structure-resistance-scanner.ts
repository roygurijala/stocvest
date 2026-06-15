/**
 * Structural resistance/support from daily OHLC — pivot highs/lows + recent extremes.
 * Keep in sync with stocvest/signals/structure_resistance_scanner.py.
 */

export type OhlcBar = { low: number; high: number };

export const PIVOT_WINDOW = 2;
export const RECENT_WINDOW = 12;
export const DEFAULT_PROXIMITY_PCT = 25;

function barAttr(bar: OhlcBar, key: "low" | "high"): number | null {
  const v = bar[key];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

export function swingPivotValues(
  bars: OhlcBar[],
  attr: "low" | "high",
  isHigh: boolean,
  pivotWindow: number = PIVOT_WINDOW
): number[] {
  const vals: number[] = [];
  const n = bars.length;
  if (n < 2 * pivotWindow + 1) return vals;
  for (let i = pivotWindow; i < n - pivotWindow; i++) {
    const center = barAttr(bars[i], attr);
    if (center == null) continue;
    let isPivot = true;
    for (let j = i - pivotWindow; j <= i + pivotWindow; j++) {
      if (j === i) continue;
      const other = barAttr(bars[j], attr);
      if (other == null) {
        isPivot = false;
        break;
      }
      if ((isHigh && other > center) || (!isHigh && other < center)) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) vals.push(center);
  }
  return vals;
}

function highCandidates(bars: OhlcBar[], pivotWindow: number, recentWindow: number): number[] {
  const out = [...swingPivotValues(bars, "high", true, pivotWindow)];
  const recent = recentWindow > 0 ? bars.slice(-recentWindow) : bars;
  const highs = recent.map((b) => barAttr(b, "high")).filter((h): h is number => h != null);
  if (highs.length) out.push(Math.max(...highs));
  return out;
}

function lowCandidates(bars: OhlcBar[], pivotWindow: number, recentWindow: number): number[] {
  const out = [...swingPivotValues(bars, "low", false, pivotWindow)];
  const recent = recentWindow > 0 ? bars.slice(-recentWindow) : bars;
  const lows = recent.map((b) => barAttr(b, "low")).filter((lo): lo is number => lo != null);
  if (lows.length) out.push(Math.min(...lows));
  return out;
}

export function scanNearestResistanceAbove(
  bars: OhlcBar[] | null | undefined,
  opts: {
    last: number;
    floorAbove: number;
    proximityPct?: number;
    extraLevels?: number[];
  }
): number | null {
  const { last, floorAbove, proximityPct = DEFAULT_PROXIMITY_PCT, extraLevels = [] } = opts;
  if (!bars?.length || last <= 0 || floorAbove <= 0) return null;
  const hiCap = last * (1 + proximityPct / 100);
  const candidates: number[] = [];
  for (const level of highCandidates(bars, PIVOT_WINDOW, RECENT_WINDOW)) {
    if (level > floorAbove + 1e-6 && level > last + 1e-6 && level <= hiCap + 1e-6) candidates.push(level);
  }
  for (const raw of extraLevels) {
    if (raw > floorAbove + 1e-6 && raw > last + 1e-6) candidates.push(raw);
  }
  if (!candidates.length) return null;
  return Math.round(Math.min(...candidates) * 10000) / 10000;
}

export function scanNearestSupportBelow(
  bars: OhlcBar[] | null | undefined,
  opts: {
    last: number;
    ceilingBelow: number;
    proximityPct?: number;
    extraLevels?: number[];
  }
): number | null {
  const { last, ceilingBelow, proximityPct = DEFAULT_PROXIMITY_PCT, extraLevels = [] } = opts;
  if (!bars?.length || last <= 0 || ceilingBelow <= 0) return null;
  const loCap = last * (1 - proximityPct / 100);
  const candidates: number[] = [];
  for (const level of lowCandidates(bars, PIVOT_WINDOW, RECENT_WINDOW)) {
    if (level < ceilingBelow - 1e-6 && level < last - 1e-6 && level >= loCap - 1e-6) candidates.push(level);
  }
  for (const raw of extraLevels) {
    if (raw < ceilingBelow - 1e-6 && raw < last - 1e-6) candidates.push(raw);
  }
  if (!candidates.length) return null;
  return Math.round(Math.max(...candidates) * 10000) / 10000;
}

export function dailyBarsFromComposite(body: Record<string, unknown> | null | undefined): OhlcBar[] {
  const raw = body?.daily_bars_range;
  if (!Array.isArray(raw)) return [];
  const out: OhlcBar[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const lo = typeof r.low === "number" && Number.isFinite(r.low) ? r.low : null;
    const hi = typeof r.high === "number" && Number.isFinite(r.high) ? r.high : null;
    if (lo != null && hi != null && hi >= lo) out.push({ low: lo, high: hi });
  }
  return out;
}
