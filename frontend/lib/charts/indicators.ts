/**
 * Pure indicator math for the trading charts. No Lightweight-Charts or React
 * dependency — every function takes plain OHLCV bars and returns plain points,
 * so it can be unit-tested in isolation and reused across day/swing modes.
 *
 * Time is carried through untouched: it's either a UNIX timestamp in seconds
 * (intraday bars) or a business-day object (daily/weekly bars), matching what
 * Lightweight-Charts expects per scale.
 */

export type IndicatorTime = number | { year: number; month: number; day: number };

export interface IndicatorBar {
  time: IndicatorTime;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorPoint {
  time: IndicatorTime;
  value: number;
}

/** Simple moving average of the close over `period` bars. */
export function sma(bars: IndicatorBar[], period: number): IndicatorPoint[] {
  if (period < 1 || bars.length < period) return [];
  const out: IndicatorPoint[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i += 1) {
    sum += bars[i].close;
    if (i >= period) sum -= bars[i - period].close;
    if (i >= period - 1) out.push({ time: bars[i].time, value: sum / period });
  }
  return out;
}

/**
 * Exponential moving average of the close. Seeded with the SMA of the first
 * `period` bars (the conventional seed), then smoothed with k = 2/(period+1).
 */
export function ema(bars: IndicatorBar[], period: number): IndicatorPoint[] {
  if (period < 1 || bars.length < period) return [];
  const k = 2 / (period + 1);
  const out: IndicatorPoint[] = [];
  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += bars[i].close;
  let prev = seed / period;
  out.push({ time: bars[period - 1].time, value: prev });
  for (let i = period; i < bars.length; i += 1) {
    prev = bars[i].close * k + prev * (1 - k);
    out.push({ time: bars[i].time, value: prev });
  }
  return out;
}

/** YYYY-MM-DD in US/Eastern for a UNIX-seconds timestamp (session boundary key). */
function etDateKey(unixSeconds: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(unixSeconds * 1000));
}

/** Minutes since ET midnight for a UNIX-seconds timestamp. */
function etMinutesOfDay(unixSeconds: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false
  }).formatToParts(new Date(unixSeconds * 1000));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/**
 * Volume-weighted average price as a running curve that RESETS at the start of
 * each ET session — the standard intraday VWAP. Only meaningful for intraday
 * bars (time as UNIX seconds); daily/weekly bars are returned empty.
 */
export function sessionVwap(bars: IndicatorBar[]): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  let curKey: string | null = null;
  let cumPV = 0;
  let cumV = 0;
  for (const b of bars) {
    if (typeof b.time !== "number") return [];
    const key = etDateKey(b.time);
    if (key !== curKey) {
      curKey = key;
      cumPV = 0;
      cumV = 0;
    }
    const typical = (b.high + b.low + b.close) / 3;
    const vol = b.volume > 0 ? b.volume : 0;
    cumPV += typical * vol;
    cumV += vol;
    out.push({ time: b.time, value: cumV > 0 ? cumPV / cumV : typical });
  }
  return out;
}

/**
 * Opening-range high/low: the high and low across the first `windowMinutes` of
 * the most recent ET session (default 30 min = the classic ORB window). Returns
 * null when there aren't enough intraday bars in the opening window.
 */
export function openingRange(
  bars: IndicatorBar[],
  windowMinutes = 30
): { high: number; low: number } | null {
  const SESSION_OPEN = 9 * 60 + 30; // 9:30 AM ET
  const intraday = bars.filter((b) => typeof b.time === "number") as (IndicatorBar & {
    time: number;
  })[];
  if (intraday.length === 0) return null;
  // Identify the latest session by its ET date key.
  const lastKey = etDateKey(intraday[intraday.length - 1].time);
  let high = -Infinity;
  let low = Infinity;
  for (const b of intraday) {
    if (etDateKey(b.time) !== lastKey) continue;
    const mins = etMinutesOfDay(b.time);
    if (mins >= SESSION_OPEN && mins < SESSION_OPEN + windowMinutes) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
    }
  }
  if (!Number.isFinite(high) || !Number.isFinite(low) || high <= low) return null;
  return { high, low };
}

/**
 * 52-week (≈252 trading days) high/low from the available daily bars. Uses up to
 * the last 252 bars so it stays correct even when the caller fetched more.
 */
export function fiftyTwoWeek(bars: IndicatorBar[]): { high: number; low: number } | null {
  if (bars.length === 0) return null;
  const window = bars.slice(-252);
  let high = -Infinity;
  let low = Infinity;
  for (const b of window) {
    if (b.high > high) high = b.high;
    if (b.low < low) low = b.low;
  }
  if (!Number.isFinite(high) || !Number.isFinite(low) || high <= low) return null;
  return { high, low };
}

/** High/low across the last `sessions` daily bars (the swing-range stat). */
export function sessionRange(
  bars: IndicatorBar[],
  sessions = 10
): { high: number; low: number } | null {
  if (bars.length === 0) return null;
  const window = bars.slice(-sessions);
  let high = -Infinity;
  let low = Infinity;
  for (const b of window) {
    if (b.high > high) high = b.high;
    if (b.low < low) low = b.low;
  }
  if (!Number.isFinite(high) || !Number.isFinite(low) || high <= low) return null;
  return { high, low };
}

/** Session (visible-set) high/low — the simple max/min of the bar set. */
export function highLow(bars: IndicatorBar[]): { high: number; low: number } | null {
  if (bars.length === 0) return null;
  let high = -Infinity;
  let low = Infinity;
  for (const b of bars) {
    if (b.high > high) high = b.high;
    if (b.low < low) low = b.low;
  }
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  return { high, low };
}
