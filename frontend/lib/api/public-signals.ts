"use client";

export type PublicSignalOutcome = "pending" | "win" | "loss" | "neutral";
export type PublicSignalDirection = "long" | "short" | "neutral";

export interface PublicSignal {
  symbol: string;
  direction: PublicSignalDirection;
  signal_strength: number;
  timestamp_iso: string;
  outcome: PublicSignalOutcome;
  disclaimer?: string;
  price_at_signal?: number | null;
  price_outcome?: number | null;
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
  return {
    symbol: raw.symbol,
    direction: raw.direction as PublicSignalDirection,
    signal_strength: strength,
    timestamp_iso: raw.timestamp_iso,
    outcome,
    disclaimer: typeof raw.disclaimer === "string" ? raw.disclaimer : undefined
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
