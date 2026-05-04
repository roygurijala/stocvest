"use client";

import { isoDateInNewYork } from "@/lib/market-hours-et";

export type PublicSignalOutcome = "pending" | "correct" | "incorrect" | "neutral";
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

/** When API adds per-pattern stats, map them here for the landing accuracy bars. */
export interface PatternAccuracyRow {
  pattern_key: string;
  label: string;
  accuracy_percent: number;
  tone?: "long" | "short" | "amber" | "green";
}

export interface PerformanceSummary {
  total_signals_tracked: number;
  signals_evaluated: number;
  correct_direction_count: number;
  incorrect_direction_count: number;
  neutral_direction_count: number;
  directional_accuracy_percent: number;
  launch_date: string;
  date_range_days: number;
  disclaimer?: string;
  /** Optional: populated when GET /v1/signals/performance/summary includes per-pattern breakdown. */
  pattern_breakdown?: PatternAccuracyRow[];
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
  const outcomeRaw = raw.outcome;
  let outcome: PublicSignalOutcome;
  if (outcomeRaw === "pending") outcome = "pending";
  else if (outcomeRaw === "correct" || outcomeRaw === "win") outcome = "correct";
  else if (outcomeRaw === "incorrect" || outcomeRaw === "loss") outcome = "incorrect";
  else if (outcomeRaw === "neutral") outcome = "neutral";
  else return null;
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

/** Authenticated user's evaluated signals (platform + user-scoped rows for that account). Returns null if not signed in. */
export async function fetchUserEvaluatedSignals(params?: {
  days?: number;
  limit?: number;
  symbol?: string;
}): Promise<PublicSignal[] | null> {
  const qs = new URLSearchParams();
  if (params?.days != null) qs.set("days", String(params.days));
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.symbol?.trim()) qs.set("symbol", params.symbol.trim().toUpperCase());
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  try {
    const response = await fetch(`/api/stocvest/signals/me/history${suffix}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });
    if (response.status === 401) {
      return null;
    }
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
      cache: "no-store"
    });
    if (!response.ok) {
      return fallback;
    }
    const data = (await response.json()) as Record<string, unknown>;
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
        const t =
          tone === "long" || tone === "short" || tone === "amber" || tone === "green" ? tone : undefined;
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
  } catch {
    return fallback;
  }
}

/** Row label for 1h / 1d outcome chips (signal outcome tracking terminology). */
export function formatHorizonOutcome(
  o: string | null | undefined
): { label: string; kind: "ok" | "bad" | "mid" | "pending" } {
  if (o === "correct") return { label: "Outcome: Correct", kind: "ok" };
  if (o === "incorrect") return { label: "Price moved opposite", kind: "bad" };
  if (o === "neutral") return { label: "Neutral move", kind: "mid" };
  return { label: "Pending evaluation", kind: "pending" };
}
