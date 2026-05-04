import type { PerformanceSummary, PatternAccuracyRow } from "@/lib/api/public-signals";
import { isoDateInNewYork } from "@/lib/market-hours-et";

const DEFAULT_BASE_URL = "http://localhost:3001";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_STOCVEST_API_BASE_URL || DEFAULT_BASE_URL;
}

export interface LandingSignal {
  symbol: string;
  direction: "bullish" | "bearish" | "neutral";
  signal_strength: number;
  pattern: string;
  generated_at: string;
  layer_scores: {
    technical: number;
    news: number;
    macro: number;
    sector: number;
    geopolitical: number;
    internals: number;
  };
  outcome_1h: "correct" | "incorrect" | "neutral" | null;
  price_at_signal: number;
  price_1h_after: number | null;
  ai_summary: string | null;
  disclaimer: string;
}

function normalizeLandingSignal(raw: Record<string, unknown>): LandingSignal | null {
  if (typeof raw.symbol !== "string" || typeof raw.direction !== "string") return null;
  const d = raw.direction.toLowerCase();
  if (d !== "bullish" && d !== "bearish" && d !== "neutral") return null;
  const layers = raw.layer_scores;
  if (!layers || typeof layers !== "object") return null;
  const L = layers as Record<string, unknown>;
  const num = (k: string) => {
    const v = L[k];
    return typeof v === "number" && Number.isFinite(v) ? v : Number(v);
  };
  const layer_scores = {
    technical: num("technical"),
    news: num("news"),
    macro: num("macro"),
    sector: num("sector"),
    geopolitical: num("geopolitical"),
    internals: num("internals")
  };
  if (!Object.values(layer_scores).every((n) => Number.isFinite(n))) return null;
  const strength = raw.signal_strength;
  const ss = typeof strength === "number" ? strength : Number(strength);
  if (!Number.isFinite(ss)) return null;
  const pat = raw.pattern;
  const gen = raw.generated_at;
  if (typeof pat !== "string" || typeof gen !== "string") return null;
  const o1h = raw.outcome_1h;
  let outcome_1h: LandingSignal["outcome_1h"] = null;
  if (o1h === "correct" || o1h === "incorrect" || o1h === "neutral") outcome_1h = o1h;
  const pAt = raw.price_at_signal;
  const p1h = raw.price_1h_after;
  const price_at_signal = typeof pAt === "number" ? pAt : Number(pAt);
  if (!Number.isFinite(price_at_signal)) return null;
  let price_1h_after: number | null = null;
  if (p1h != null) {
    const n = typeof p1h === "number" ? p1h : Number(p1h);
    price_1h_after = Number.isFinite(n) ? n : null;
  }
  const disc = raw.disclaimer;
  if (typeof disc !== "string") return null;
  const ai = raw.ai_summary;
  return {
    symbol: raw.symbol.toUpperCase(),
    direction: d as LandingSignal["direction"],
    signal_strength: Math.round(ss),
    pattern: pat,
    generated_at: gen,
    layer_scores: layer_scores as LandingSignal["layer_scores"],
    outcome_1h,
    price_at_signal,
    price_1h_after,
    ai_summary: typeof ai === "string" ? ai : ai == null ? null : String(ai),
    disclaimer: disc
  };
}

export async function fetchLandingSignals(): Promise<LandingSignal[]> {
  try {
    const res = await fetch(`${apiBaseUrl()}/v1/signals/recent?landing=true`, {
      method: "GET",
      next: { revalidate: 1800 }
    });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    const arr = Array.isArray(data)
      ? data
      : data && typeof data === "object" && "items" in data && Array.isArray((data as { items: unknown }).items)
        ? (data as { items: unknown[] }).items
        : [];
    return arr
      .map((x) => (typeof x === "object" && x !== null ? normalizeLandingSignal(x as Record<string, unknown>) : null))
      .filter((x): x is LandingSignal => x !== null);
  } catch {
    return [];
  }
}

const FALLBACK_DISCLAIMER = "Signal data for informational purposes only. Not investment advice.";

const ET_TZ = "America/New_York";

/** Calendar YYYY-MM-DD in Eastern for a given instant. */
function dateStrEt(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ET_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(ms));
}

/** Yesterday's calendar date string (en-CA) in America/New_York. */
function yesterdayDateStrEt(): string {
  const now = Date.now();
  const todayStr = dateStrEt(now);
  let best = "";
  for (let t = now - 72 * 3600 * 1000; t <= now; t += 15 * 60 * 1000) {
    const s = dateStrEt(t);
    if (s < todayStr && s > best) best = s;
  }
  return best || dateStrEt(now - 24 * 3600 * 1000);
}

/**
 * ISO timestamp for yesterday at hourEt:minuteEt in America/New_York (DST-aware).
 * Used so the landing explorer shows e.g. "Yesterday · 9:42 AM" in ET year-round.
 */
function yesterdayEtWallTimeToIso(hourEt: number, minuteEt: number): string {
  const targetDay = yesterdayDateStrEt();
  const dateFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const now = Date.now();
  for (let t = now - 120 * 3600 * 1000; t <= now + 2 * 3600 * 1000; t += 60 * 1000) {
    const d = new Date(t);
    if (dateFmt.format(d) !== targetDay) continue;
    const parts = Object.fromEntries(
      timeFmt.formatToParts(d).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
    ) as { hour: string; minute: string };
    if (Number(parts.hour) === hourEt && Number(parts.minute) === minuteEt) return d.toISOString();
  }
  const d = new Date(now - 24 * 3600 * 1000);
  return d.toISOString();
}

export const FALLBACK_SIGNALS: LandingSignal[] = [
  {
    symbol: "TSLA",
    direction: "bullish",
    signal_strength: 91,
    pattern: "confluence_alert",
    generated_at: yesterdayEtWallTimeToIso(9, 38),
    layer_scores: {
      technical: 94,
      news: 88,
      macro: 70,
      sector: 85,
      geopolitical: 72,
      internals: 90
    },
    outcome_1h: "correct",
    price_at_signal: 248.3,
    price_1h_after: 254.1,
    ai_summary:
      "Rare confluence of 6 confirming signals. ORB breakout with bullish regime and strong catalyst alignment.",
    disclaimer: FALLBACK_DISCLAIMER
  },
  {
    symbol: "NVDA",
    direction: "bullish",
    signal_strength: 82,
    pattern: "orb_breakout_long",
    generated_at: yesterdayEtWallTimeToIso(9, 42),
    layer_scores: {
      technical: 88,
      news: 91,
      macro: 62,
      sector: 79,
      geopolitical: 70,
      internals: 83
    },
    outcome_1h: "correct",
    price_at_signal: 112.4,
    price_1h_after: 113.9,
    ai_summary:
      "Strong technical momentum backed by AI infrastructure demand catalyst. Macro uncertainty from Fed meeting is primary risk.",
    disclaimer: FALLBACK_DISCLAIMER
  },
  {
    symbol: "AAPL",
    direction: "bullish",
    signal_strength: 74,
    pattern: "vwap_reclaim",
    generated_at: yesterdayEtWallTimeToIso(10, 8),
    layer_scores: {
      technical: 76,
      news: 68,
      macro: 58,
      sector: 72,
      geopolitical: 65,
      internals: 70
    },
    outcome_1h: "correct",
    price_at_signal: 201.8,
    price_1h_after: 203.4,
    ai_summary:
      "VWAP reclaim on above-average volume with positive sector tailwind. Watch for continuation above $202.50.",
    disclaimer: FALLBACK_DISCLAIMER
  },
  {
    symbol: "AMD",
    direction: "bullish",
    signal_strength: 68,
    pattern: "vwap_reclaim",
    generated_at: yesterdayEtWallTimeToIso(10, 24),
    layer_scores: {
      technical: 72,
      news: 65,
      macro: 58,
      sector: 74,
      geopolitical: 60,
      internals: 68
    },
    outcome_1h: "correct",
    price_at_signal: 178.2,
    price_1h_after: 180.4,
    ai_summary:
      "VWAP reclaim with sector tailwind. Semiconductor momentum supporting continuation.",
    disclaimer: FALLBACK_DISCLAIMER
  },
  {
    symbol: "SPY",
    direction: "bullish",
    signal_strength: 61,
    pattern: "9ema_bounce",
    generated_at: yesterdayEtWallTimeToIso(11, 15),
    layer_scores: {
      technical: 65,
      news: 55,
      macro: 62,
      sector: 60,
      geopolitical: 58,
      internals: 64
    },
    outcome_1h: "incorrect",
    price_at_signal: 524.8,
    price_1h_after: 522.1,
    ai_summary:
      "9 EMA bounce setup with mixed macro signals. Lower conviction — macro headwinds present.",
    disclaimer: FALLBACK_DISCLAIMER
  }
];

function parsePerformanceSummaryJson(data: Record<string, unknown>): PerformanceSummary {
  const fallback: PerformanceSummary = {
    total_signals_tracked: 0,
    signals_evaluated: 0,
    correct_direction_count: 0,
    incorrect_direction_count: 0,
    neutral_direction_count: 0,
    directional_accuracy_percent: 0,
    launch_date: isoDateInNewYork(),
    date_range_days: 0
  };
  const evaluated = data.signals_evaluated ?? data.total_resolved;
  const accuracy = data.directional_accuracy_percent ?? data.win_rate_percent;
  const correctDir =
    typeof data.correct_direction_count === "number"
      ? data.correct_direction_count
      : typeof data.win_count === "number"
        ? data.win_count
        : fallback.correct_direction_count;
  const incorrectDir =
    typeof data.incorrect_direction_count === "number"
      ? data.incorrect_direction_count
      : typeof data.loss_count === "number"
        ? data.loss_count
        : fallback.incorrect_direction_count;
  const neutralDir =
    typeof data.neutral_direction_count === "number"
      ? data.neutral_direction_count
      : typeof data.neutral_count === "number"
        ? data.neutral_count
        : fallback.neutral_direction_count;
  const rawPb = data.pattern_breakdown;
  let pattern_breakdown: PatternAccuracyRow[] | undefined;
  if (Array.isArray(rawPb)) {
    const rows: PatternAccuracyRow[] = [];
    for (const item of rawPb) {
      if (typeof item !== "object" || item === null) continue;
      const o = item as Record<string, unknown>;
      const label = typeof o.label === "string" ? o.label : typeof o.pattern === "string" ? o.pattern : "";
      const pct = o.accuracy_percent ?? o.accuracy;
      const n = typeof pct === "number" ? pct : pct != null ? Number(pct) : Number.NaN;
      const key = typeof o.pattern_key === "string" ? o.pattern_key : label;
      if (!label.trim() || !Number.isFinite(n)) continue;
      const tone = o.tone;
      const t = tone === "long" || tone === "short" || tone === "amber" || tone === "green" ? tone : undefined;
      rows.push({
        pattern_key: key || label,
        label: label.trim(),
        accuracy_percent: Math.round(Math.max(0, Math.min(100, n)) * 10) / 10,
        tone: t
      });
    }
    if (rows.length > 0) pattern_breakdown = rows;
  }
  return {
    ...fallback,
    total_signals_tracked: typeof data.total_signals_tracked === "number" ? data.total_signals_tracked : fallback.total_signals_tracked,
    signals_evaluated: typeof evaluated === "number" ? evaluated : fallback.signals_evaluated,
    correct_direction_count: correctDir,
    incorrect_direction_count: incorrectDir,
    neutral_direction_count: neutralDir,
    directional_accuracy_percent: typeof accuracy === "number" ? accuracy : fallback.directional_accuracy_percent,
    launch_date: typeof data.launch_date === "string" ? data.launch_date : fallback.launch_date,
    date_range_days: typeof data.date_range_days === "number" ? data.date_range_days : fallback.date_range_days,
    disclaimer: typeof data.disclaimer === "string" ? data.disclaimer : undefined,
    pattern_breakdown
  };
}

export async function fetchLandingPerformanceSummary(): Promise<PerformanceSummary> {
  const empty: PerformanceSummary = {
    total_signals_tracked: 0,
    signals_evaluated: 0,
    correct_direction_count: 0,
    incorrect_direction_count: 0,
    neutral_direction_count: 0,
    directional_accuracy_percent: 0,
    launch_date: isoDateInNewYork(),
    date_range_days: 0
  };
  try {
    const response = await fetch(`${apiBaseUrl()}/v1/signals/performance/summary`, {
      method: "GET",
      next: { revalidate: 1800 }
    });
    if (!response.ok) return empty;
    const data = (await response.json()) as Record<string, unknown>;
    return parsePerformanceSummaryJson(data);
  } catch {
    return empty;
  }
}
