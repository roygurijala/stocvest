/**
 * Pure, dependency-free chart configuration: candle-fetch depth, minimum
 * visible bars, the swing default viewport width, and small helpers. Kept in
 * its own module (no React / no lightweight-charts) so the fetch-vs-warmup
 * invariants are unit-testable in isolation and can't silently regress.
 *
 * Warmup invariant (why fetch > display): indicators are computed over the FULL
 * fetched set and only the viewport is narrowed. For an SMA(period) to be valid
 * across the entire default swing viewport we must fetch at least
 * `SWING_DAILY_VISIBLE_BARS + period` daily bars. `FETCH_LIMIT["1day"]` is sized
 * so SMA 20/50/200 all fully cover the visible 6-month window.
 */

export type ChartTimeframe =
  | "1min"
  | "5min"
  | "15min"
  | "30min"
  | "1hour"
  | "4hour"
  | "1day"
  | "1week"
  | "1month";

/**
 * `position` = the long-horizon ("Long Term") desk chart: weekly candles by
 * default, multi-year lookback, long moving averages. Distinct from `swing`
 * (daily, 6-month) so a multi-year holding isn't read off a 6-month tape.
 */
export type ChartMode = "day" | "swing" | "position";

/** Longest SMA the swing chart draws — SMA 200 needs 200 bars of warmup. */
export const MAX_SWING_SMA_PERIOD = 200;

/** Longest SMA any mode draws (position uses 200 too, on weekly/daily bars). */
export const MAX_SMA_PERIOD = 200;

/** Default swing daily viewport (≈6 months of trading days). */
export const SWING_DAILY_VISIBLE_BARS = 126;

/**
 * Default long-term ("position") viewports, in bars of the selected timeframe:
 * ~2y of daily, ~3y of weekly, ~10y of monthly. Wide enough to read a
 * multi-year holding without drowning the recent structure.
 */
export const POSITION_VISIBLE_BARS: Record<"1day" | "1week" | "1month", number> = {
  "1day": 252,
  "1week": 156,
  "1month": 120
};

/** SMA periods drawn per mode (in bars of the active timeframe). */
export const SWING_SMA_PERIODS = [20, 50, 200] as const;
export const POSITION_SMA_PERIODS = [50, 100, 200] as const;

/**
 * Bars requested per timeframe for the day/swing/legacy charts. Daily is sized
 * `SWING_DAILY_VISIBLE_BARS + MAX_SWING_SMA_PERIOD + headroom` so SMA 200 spans
 * the whole visible window. Weekly/monthly here are the shallow defaults used
 * by the swing switcher's rarely-used long views; the long-term desk requests
 * deeper history via `fetchLimitFor("position", …)`.
 */
export const FETCH_LIMIT: Record<ChartTimeframe, number> = {
  "1min": 1200,
  "5min": 600,
  "15min": 400,
  "30min": 320,
  "1hour": 500,
  "4hour": 300,
  "1day": 340,
  "1week": 200,
  "1month": 240
};

export const MIN_VISIBLE: Record<ChartTimeframe, number> = {
  "1min": 120,
  "5min": 48,
  "15min": 24,
  "30min": 16,
  "1hour": 14,
  "4hour": 12,
  "1day": 30,
  "1week": 20,
  "1month": 12
};

export function isIntradayTf(tf: ChartTimeframe): boolean {
  return tf === "1min" || tf === "5min" || tf === "15min" || tf === "30min" || tf === "1hour" || tf === "4hour";
}

export function defaultTimeframe(
  mode: ChartMode | undefined,
  explicit: ChartTimeframe | undefined
): ChartTimeframe {
  if (explicit) return explicit;
  if (mode === "day") return "5min";
  if (mode === "position") return "1week"; // long-term desk defaults to weekly candles
  return "1day";
}

/**
 * How many bars to fetch for a given mode+timeframe. The long-term desk pulls
 * deeper history than swing so its long MAs (up to SMA 200) stay valid across
 * its multi-year viewport: `POSITION_VISIBLE_BARS + MAX_SMA_PERIOD + headroom`.
 * Monthly SMA 200 (≈16.7y) still depends on the symbol actually having that
 * much history — `sma()` returns empty when it doesn't, so it degrades cleanly.
 */
export function fetchLimitFor(mode: ChartMode | undefined, tf: ChartTimeframe): number {
  if (mode === "position" && (tf === "1day" || tf === "1week" || tf === "1month")) {
    return POSITION_VISIBLE_BARS[tf] + MAX_SMA_PERIOD + 12;
  }
  return FETCH_LIMIT[tf] ?? 300;
}

/**
 * Default visible-bar count for a non-intraday rich chart (null = intraday,
 * which is sized by `MIN_VISIBLE` instead). Swing daily shows ~6 months;
 * the long-term desk shows its per-timeframe multi-year window.
 */
export function visibleBarsFor(mode: ChartMode | undefined, tf: ChartTimeframe): number | null {
  if (isIntradayTf(tf)) return null;
  if (mode === "position" && (tf === "1day" || tf === "1week" || tf === "1month")) {
    return POSITION_VISIBLE_BARS[tf];
  }
  return SWING_DAILY_VISIBLE_BARS;
}
