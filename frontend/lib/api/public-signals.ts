"use client";

export type PublicSignalOutcome = "pending" | "win" | "loss" | "neutral";
export type PublicSignalDirection = "long" | "short" | "neutral";
export type SignalBias = "bullish" | "bearish" | "neutral";

export interface PublicSignal {
  signal_id?: string;
  symbol: string;
  direction: PublicSignalDirection;
  /** Original API bias for chips (bullish / bearish / neutral). */
  bias: SignalBias;
  signal_strength: number;
  timestamp_iso: string;
  outcome: PublicSignalOutcome;
  disclaimer?: string;
  price_at_signal?: number | null;
  price_outcome?: number | null;
  pattern?: string;
  outcome_1h?: string | null;
  outcome_1d?: string | null;
  resolved_1h?: boolean;
  resolved_1d?: boolean;
  price_1h_after?: number | null;
  price_1d_after?: number | null;
}

export interface PerformanceSummary {
  total_signals_tracked: number;
  signals_evaluated: number;
  win_count: number;
  loss_count: number;
  neutral_count: number;
  directional_accuracy_percent: number;
  launch_date: string;
  date_range_days: number;
  disclaimer?: string;
}

const DEFAULT_BASE_URL = "http://localhost:3001";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_STOCVEST_API_BASE_URL || DEFAULT_BASE_URL;
}

function mapDirectionAndBias(rawDir: string): { direction: PublicSignalDirection; bias: SignalBias } {
  const d = rawDir.toLowerCase();
  if (d === "bullish" || d === "long" || d === "buy") {
    return { direction: "long", bias: "bullish" };
  }
  if (d === "bearish" || d === "short" || d === "sell") {
    return { direction: "short", bias: "bearish" };
  }
  return { direction: "neutral", bias: "neutral" };
}

function normalizePublicSignal(raw: Record<string, unknown>): PublicSignal | null {
  if (typeof raw.symbol !== "string" || typeof raw.direction !== "string" || typeof raw.timestamp_iso !== "string") {
    return null;
  }
  const strengthRaw = raw.signal_strength ?? raw.confidence;
  const strength = typeof strengthRaw === "number" ? strengthRaw : Number(strengthRaw);
  if (!Number.isFinite(strength)) {
    return null;
  }
  const outcome = raw.outcome;
  if (outcome !== "pending" && outcome !== "win" && outcome !== "loss" && outcome !== "neutral") {
    return null;
  }
  const { direction, bias } = mapDirectionAndBias(raw.direction);
  const sid = raw.signal_id;
  const pat = raw.pattern;
  const o1h = raw.outcome_1h;
  const o1d = raw.outcome_1d;
  const pAt = raw.price_at_signal;
  return {
    signal_id: typeof sid === "string" ? sid : undefined,
    symbol: raw.symbol,
    direction,
    bias,
    signal_strength: strength,
    timestamp_iso: raw.timestamp_iso,
    outcome,
    disclaimer: typeof raw.disclaimer === "string" ? raw.disclaimer : undefined,
    price_at_signal: typeof pAt === "number" ? pAt : pAt != null ? Number(pAt) : null,
    pattern: typeof pat === "string" ? pat : undefined,
    outcome_1h: typeof o1h === "string" ? o1h : o1h == null ? null : String(o1h),
    outcome_1d: typeof o1d === "string" ? o1d : o1d == null ? null : String(o1d),
    resolved_1h: typeof raw.resolved_1h === "boolean" ? raw.resolved_1h : undefined,
    resolved_1d: typeof raw.resolved_1d === "boolean" ? raw.resolved_1d : undefined,
    price_1h_after:
      typeof raw.price_1h_after === "number"
        ? raw.price_1h_after
        : raw.price_1h_after != null
          ? Number(raw.price_1h_after)
          : null,
    price_1d_after:
      typeof raw.price_1d_after === "number"
        ? raw.price_1d_after
        : raw.price_1d_after != null
          ? Number(raw.price_1d_after)
          : null
  };
}

export async function fetchLiveSignals(): Promise<PublicSignal[]> {
  try {
    const response = await fetch(`${apiBaseUrl()}/v1/signals/recent`, {
      method: "GET",
      cache: "no-store"
    });
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as unknown;
    if (!Array.isArray(data)) {
      return [];
    }
    return data
      .map((x) => (typeof x === "object" && x !== null ? normalizePublicSignal(x as Record<string, unknown>) : null))
      .filter((x): x is PublicSignal => x !== null);
  } catch {
    return [];
  }
}

export async function fetchPerformanceSummary(): Promise<PerformanceSummary> {
  const fallback: PerformanceSummary = {
    total_signals_tracked: 0,
    signals_evaluated: 0,
    win_count: 0,
    loss_count: 0,
    neutral_count: 0,
    directional_accuracy_percent: 0,
    launch_date: new Date().toISOString().slice(0, 10),
    date_range_days: 0
  };
  try {
    const response = await fetch(`${apiBaseUrl()}/v1/signals/performance/summary`, {
      method: "GET",
      cache: "no-store"
    });
    if (!response.ok) {
      return fallback;
    }
    const data = (await response.json()) as Record<string, unknown>;
    const evaluated = data.signals_evaluated ?? data.total_resolved;
    const accuracy = data.directional_accuracy_percent ?? data.win_rate_percent;
    return {
      ...fallback,
      total_signals_tracked: typeof data.total_signals_tracked === "number" ? data.total_signals_tracked : fallback.total_signals_tracked,
      signals_evaluated: typeof evaluated === "number" ? evaluated : fallback.signals_evaluated,
      win_count: typeof data.win_count === "number" ? data.win_count : fallback.win_count,
      loss_count: typeof data.loss_count === "number" ? data.loss_count : fallback.loss_count,
      neutral_count: typeof data.neutral_count === "number" ? data.neutral_count : fallback.neutral_count,
      directional_accuracy_percent: typeof accuracy === "number" ? accuracy : fallback.directional_accuracy_percent,
      launch_date: typeof data.launch_date === "string" ? data.launch_date : fallback.launch_date,
      date_range_days: typeof data.date_range_days === "number" ? data.date_range_days : fallback.date_range_days,
      disclaimer: typeof data.disclaimer === "string" ? data.disclaimer : undefined
    };
  } catch {
    return fallback;
  }
}

/** Row label for 1h / 1d outcome chips in history tables. */
export function formatHorizonOutcome(
  o: string | null | undefined
): { label: string; kind: "ok" | "bad" | "mid" | "pending" } {
  if (o === "correct") return { label: "✅ Correct", kind: "ok" };
  if (o === "incorrect") return { label: "❌ Incorrect", kind: "bad" };
  if (o === "neutral") return { label: "~ Neutral", kind: "mid" };
  return { label: "— Pending", kind: "pending" };
}
