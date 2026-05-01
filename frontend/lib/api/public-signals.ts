"use client";

export type PublicSignalOutcome = "pending" | "win" | "loss" | "neutral";
export type PublicSignalDirection = "long" | "short" | "neutral";

export interface PublicSignal {
  symbol: string;
  direction: PublicSignalDirection;
  confidence: number;
  timestamp_iso: string;
  outcome: PublicSignalOutcome;
  price_at_signal?: number | null;
  price_outcome?: number | null;
}

export interface PerformanceSummary {
  total_signals_tracked: number;
  total_resolved: number;
  win_count: number;
  loss_count: number;
  neutral_count: number;
  win_rate_percent: number;
  launch_date: string;
  date_range_days: number;
}

const DEFAULT_BASE_URL = "http://localhost:3001";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_STOCVEST_API_BASE_URL || DEFAULT_BASE_URL;
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
    return data.filter((x): x is PublicSignal => typeof x === "object" && x !== null);
  } catch {
    return [];
  }
}

export async function fetchPerformanceSummary(): Promise<PerformanceSummary> {
  const fallback: PerformanceSummary = {
    total_signals_tracked: 0,
    total_resolved: 0,
    win_count: 0,
    loss_count: 0,
    neutral_count: 0,
    win_rate_percent: 0,
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
    const data = (await response.json()) as Partial<PerformanceSummary>;
    return {
      ...fallback,
      ...data
    };
  } catch {
    return fallback;
  }
}
