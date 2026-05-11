"use client";

import { surfaceAuthErrorIfAny } from "@/lib/auth/surface-auth-error";

/**
 * Client-side typed access to the D2 Historical Signal Validation summary endpoint.
 *
 * The backend (`stocvest/api/handlers/signals.py::historical_validation_summary_handler`)
 * returns one of two response shapes for the same window:
 *
 * - default ........... `{ summary: HistoricalValidationSummary, ...echoed params, disclaimer }`
 * - `?by_version=true` `{ by_parameter_version: { __all__, "v1", ... }, ...echoed params }`
 *
 * Both shapes share a strict NaN-safe contract: `BucketStats.accuracy` is JSON `null`
 * (never the literal `NaN`) when there are no resolved-non-neutral rows. The UI treats
 * a `null` accuracy as a calm em-dash; never as "0%".
 *
 * Runtime validation is deliberately defensive (no Zod — the codebase prefers manual
 * type guards for the API surface). Malformed responses collapse to `null` so the
 * caller can fall back to a friendly empty state rather than crashing the dashboard.
 */

// ── Types ────────────────────────────────────────────────────────────────────────────

export type ValidationHorizon = "1h" | "1d";

/** Single stratum stats. Matches `stocvest.signals.historical_validation.BucketStats`. */
export interface BucketStats {
  total_signals: number;
  correct: number;
  incorrect: number;
  neutral: number;
  resolved: number;
  /**
   * `correct / (correct + incorrect)` as a fraction in [0, 1]. `null` when there are no
   * resolved-non-neutral rows in the bucket — UI renders "—" rather than "0%".
   */
  accuracy: number | null;
}

/**
 * Full validation summary for one horizon. Matches
 * `stocvest.signals.historical_validation.HistoricalValidationSummary`.
 *
 * Every map is keyed by the canonical bucket name from the engine vocabulary; unknown
 * values land in `unknown` (for declared dimensions like decision_state / regime) or
 * `other` (for the open-ended pattern dimension).
 */
export interface HistoricalValidationSummary {
  horizon: ValidationHorizon;
  overall: BucketStats;
  by_decision: Record<string, BucketStats>;
  by_regime: Record<string, BucketStats>;
  by_mode: Record<string, BucketStats>;
  by_pattern: Record<string, BucketStats>;
  by_readiness: Record<string, BucketStats>;
  by_direction: Record<string, BucketStats>;
  rows_examined: number;
  /** Sorted, unique list of `parameter_version` strings observed in the window. */
  parameter_versions: string[];
}

export interface HistoricalValidationResponse {
  horizon: ValidationHorizon;
  from: string;
  to: string;
  mode: "swing" | "day" | null;
  symbol: string | null;
  disclaimer: string;
  summary: HistoricalValidationSummary;
}

export interface HistoricalValidationByVersionResponse {
  horizon: ValidationHorizon;
  from: string;
  to: string;
  mode: "swing" | "day" | null;
  symbol: string | null;
  disclaimer: string;
  /**
   * Always contains an `__all__` bucket carrying the combined cross-version aggregate;
   * the remaining keys are the observed `parameter_version` strings (rows missing a
   * `parameter_version` collapse into the `unknown` bucket, never silently dropped).
   */
  by_parameter_version: Record<string, HistoricalValidationSummary>;
}

// ── Runtime validation helpers ───────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseInt0(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function parseAccuracy(v: unknown): number | null {
  // Backend converts NaN to null at serialization time; we also defensively drop
  // any non-finite numbers (Infinity, -Infinity) just in case a client double-encodes.
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function parseBucketStats(raw: unknown): BucketStats | null {
  if (!isRecord(raw)) return null;
  return {
    total_signals: parseInt0(raw.total_signals),
    correct: parseInt0(raw.correct),
    incorrect: parseInt0(raw.incorrect),
    neutral: parseInt0(raw.neutral),
    resolved: parseInt0(raw.resolved),
    accuracy: parseAccuracy(raw.accuracy)
  };
}

function parseBucketMap(raw: unknown): Record<string, BucketStats> {
  if (!isRecord(raw)) return {};
  const out: Record<string, BucketStats> = {};
  for (const [key, value] of Object.entries(raw)) {
    const parsed = parseBucketStats(value);
    if (parsed) out[key] = parsed;
  }
  return out;
}

function parseHorizon(v: unknown): ValidationHorizon | null {
  return v === "1h" || v === "1d" ? v : null;
}

function parseSummary(raw: unknown): HistoricalValidationSummary | null {
  if (!isRecord(raw)) return null;
  const horizon = parseHorizon(raw.horizon);
  const overall = parseBucketStats(raw.overall);
  if (horizon === null || overall === null) return null;
  const versions = Array.isArray(raw.parameter_versions)
    ? raw.parameter_versions.filter((v): v is string => typeof v === "string")
    : [];
  return {
    horizon,
    overall,
    by_decision: parseBucketMap(raw.by_decision),
    by_regime: parseBucketMap(raw.by_regime),
    by_mode: parseBucketMap(raw.by_mode),
    by_pattern: parseBucketMap(raw.by_pattern),
    by_readiness: parseBucketMap(raw.by_readiness),
    by_direction: parseBucketMap(raw.by_direction),
    rows_examined: parseInt0(raw.rows_examined),
    parameter_versions: versions
  };
}

function parseEchoedMode(v: unknown): "swing" | "day" | null {
  return v === "swing" || v === "day" ? v : null;
}

function parseEchoedString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function parseDisclaimer(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// ── Public fetch helpers ─────────────────────────────────────────────────────────────

export interface FetchHistoricalValidationParams {
  horizon: ValidationHorizon;
  /** ISO-8601 datetime. Lower bound is inclusive. */
  from: string;
  /** ISO-8601 datetime. Upper bound is exclusive. */
  to: string;
  mode?: "swing" | "day";
  symbol?: string;
}

function buildQs(params: FetchHistoricalValidationParams, extras?: Record<string, string>): string {
  const qs = new URLSearchParams();
  qs.set("horizon", params.horizon);
  qs.set("from", params.from);
  qs.set("to", params.to);
  if (params.mode === "swing" || params.mode === "day") qs.set("mode", params.mode);
  if (params.symbol && params.symbol.trim()) qs.set("symbol", params.symbol.trim().toUpperCase());
  if (extras) {
    for (const [k, v] of Object.entries(extras)) {
      qs.set(k, v);
    }
  }
  return qs.toString();
}

/**
 * Fetch a single `HistoricalValidationSummary` for the window. Returns `null` on auth
 * failure (caller renders a "sign in to see this" state). Returns the parsed envelope
 * on success; malformed responses also collapse to `null`.
 */
export async function fetchHistoricalValidationSummary(
  params: FetchHistoricalValidationParams
): Promise<HistoricalValidationResponse | null> {
  const qs = buildQs(params);
  try {
    const response = await fetch(`/api/stocvest/signals/historical-validation/summary?${qs}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });
    if (response.status === 401) {
      void surfaceAuthErrorIfAny(response);
      return null;
    }
    if (!response.ok) return null;
    const data = (await response.json()) as unknown;
    if (!isRecord(data)) return null;
    const summary = parseSummary(data.summary);
    const horizon = parseHorizon(data.horizon);
    if (!summary || !horizon) return null;
    return {
      horizon,
      from: parseEchoedString(data.from) ?? params.from,
      to: parseEchoedString(data.to) ?? params.to,
      mode: parseEchoedMode(data.mode),
      symbol: parseEchoedString(data.symbol),
      disclaimer: parseDisclaimer(data.disclaimer),
      summary
    };
  } catch {
    return null;
  }
}

/**
 * Fetch the per-`parameter_version` map for the same window. The response always carries
 * an `__all__` bucket with the combined cross-version aggregate so a caller can render
 * "all versions" alongside the per-version breakdown without recomputing.
 */
export async function fetchHistoricalValidationByVersion(
  params: FetchHistoricalValidationParams
): Promise<HistoricalValidationByVersionResponse | null> {
  const qs = buildQs(params, { by_version: "true" });
  try {
    const response = await fetch(`/api/stocvest/signals/historical-validation/summary?${qs}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });
    if (response.status === 401) {
      void surfaceAuthErrorIfAny(response);
      return null;
    }
    if (!response.ok) return null;
    const data = (await response.json()) as unknown;
    if (!isRecord(data)) return null;
    const map = isRecord(data.by_parameter_version) ? data.by_parameter_version : null;
    const horizon = parseHorizon(data.horizon);
    if (!map || !horizon) return null;
    const parsed: Record<string, HistoricalValidationSummary> = {};
    for (const [key, value] of Object.entries(map)) {
      const summary = parseSummary(value);
      if (summary) parsed[key] = summary;
    }
    // The backend contract guarantees `__all__` is always present; if it is missing
    // the response is malformed and we collapse to null.
    if (!parsed.__all__) return null;
    return {
      horizon,
      from: parseEchoedString(data.from) ?? params.from,
      to: parseEchoedString(data.to) ?? params.to,
      mode: parseEchoedMode(data.mode),
      symbol: parseEchoedString(data.symbol),
      disclaimer: parseDisclaimer(data.disclaimer),
      by_parameter_version: parsed
    };
  } catch {
    return null;
  }
}

// ── Display helpers (shared by panel + tests) ───────────────────────────────────────

/** "—" when accuracy is null; otherwise a calm "62.5%" string. */
export function formatAccuracyPercent(accuracy: number | null): string {
  if (accuracy === null || !Number.isFinite(accuracy)) return "—";
  return `${(accuracy * 100).toFixed(1)}%`;
}

/**
 * Build a default `[from, to)` window for the panel: trailing N days ending now.
 * The dashboard component owns the picker UI; this helper centralizes the ISO formatting
 * so the BFF + handler always see the same trailing-Z form regardless of locale.
 */
export function buildTrailingWindow(daysBack: number): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString(),
    to: now.toISOString()
  };
}
