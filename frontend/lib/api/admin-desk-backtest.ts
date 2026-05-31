"use client";

import { surfaceAuthErrorIfAny } from "@/lib/auth/surface-auth-error";
import type {
  HistoricalValidationByVersionResponse,
  HistoricalValidationResponse,
  ValidationHorizon
} from "@/lib/api/historical-validation";
import {
  parseSummary,
  parseHorizon,
  parseEchoedString,
  parseEchoedMode,
  parseDisclaimer
} from "@/lib/api/historical-validation";

export type AdminValidationScope = "public" | "mine" | "all";
export type EnvironmentBacktestMode = "swing" | "day" | "all";

export interface EnvironmentBandCandidate {
  config_key: string;
  bands: { normal_enter: number; elevated_enter: number; crisis_enter: number };
  rows_with_vix: number;
  tier_counts: Record<string, number>;
  tier_agreement_pct: number | null;
  is_production: boolean;
  swing: {
    allowed_accuracy_pct: number | null;
    allowed_correct: number;
    allowed_resolved: number;
    blocked_accuracy_pct: number | null;
    blocked_correct: number;
    blocked_resolved: number;
    block_rate_pct: number | null;
  };
  day: {
    allowed_accuracy_pct: number | null;
    allowed_correct: number;
    allowed_resolved: number;
    blocked_accuracy_pct: number | null;
    blocked_correct: number;
    blocked_resolved: number;
    block_rate_pct: number | null;
  };
}

export interface EnvironmentPolicyBacktestResponse {
  horizon: ValidationHorizon;
  mode: EnvironmentBacktestMode;
  days: number;
  from: string;
  to: string;
  rows_total: number;
  rows_with_vix: number;
  production_bands: { normal_enter: number; elevated_enter: number; crisis_enter: number };
  candidates: EnvironmentBandCandidate[];
  ranked_count: number;
  disclaimer: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseCandidate(raw: unknown): EnvironmentBandCandidate | null {
  if (!isRecord(raw)) return null;
  const bands = isRecord(raw.bands) ? raw.bands : null;
  if (!bands) return null;
  const swing = isRecord(raw.swing) ? raw.swing : null;
  const day = isRecord(raw.day) ? raw.day : null;
  if (!swing || !day) return null;
  return {
    config_key: String(raw.config_key ?? ""),
    bands: {
      normal_enter: Number(bands.normal_enter),
      elevated_enter: Number(bands.elevated_enter),
      crisis_enter: Number(bands.crisis_enter)
    },
    rows_with_vix: Number(raw.rows_with_vix ?? 0),
    tier_counts: isRecord(raw.tier_counts)
      ? Object.fromEntries(
          Object.entries(raw.tier_counts).map(([k, v]) => [k, Number(v)])
        )
      : {},
    tier_agreement_pct:
      raw.tier_agreement_pct === null || raw.tier_agreement_pct === undefined
        ? null
        : Number(raw.tier_agreement_pct),
    is_production: Boolean(raw.is_production),
    swing: {
      allowed_accuracy_pct:
        swing.allowed_accuracy_pct === null ? null : Number(swing.allowed_accuracy_pct),
      allowed_correct: Number(swing.allowed_correct ?? 0),
      allowed_resolved: Number(swing.allowed_resolved ?? 0),
      blocked_accuracy_pct:
        swing.blocked_accuracy_pct === null ? null : Number(swing.blocked_accuracy_pct),
      blocked_correct: Number(swing.blocked_correct ?? 0),
      blocked_resolved: Number(swing.blocked_resolved ?? 0),
      block_rate_pct: swing.block_rate_pct === null ? null : Number(swing.block_rate_pct)
    },
    day: {
      allowed_accuracy_pct:
        day.allowed_accuracy_pct === null ? null : Number(day.allowed_accuracy_pct),
      allowed_correct: Number(day.allowed_correct ?? 0),
      allowed_resolved: Number(day.allowed_resolved ?? 0),
      blocked_accuracy_pct:
        day.blocked_accuracy_pct === null ? null : Number(day.blocked_accuracy_pct),
      blocked_correct: Number(day.blocked_correct ?? 0),
      blocked_resolved: Number(day.blocked_resolved ?? 0),
      block_rate_pct: day.block_rate_pct === null ? null : Number(day.block_rate_pct)
    }
  };
}

export async function fetchAdminHistoricalValidationSummary(params: {
  from: string;
  to: string;
  horizon: ValidationHorizon;
  mode?: "swing" | "day";
  scope?: AdminValidationScope;
}): Promise<HistoricalValidationResponse | null> {
  const qs = new URLSearchParams({
    from: params.from,
    to: params.to,
    horizon: params.horizon
  });
  if (params.mode) qs.set("mode", params.mode);
  if (params.scope === "mine") qs.set("scope", "mine");
  else if (params.scope === "all") qs.set("scope", "all");
  try {
    const response = await fetch(
      `/api/stocvest/admin/historical-validation/summary?${qs.toString()}`,
      { method: "GET", credentials: "include", cache: "no-store" }
    );
    if (response.status === 401 || response.status === 403) {
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

export async function fetchAdminHistoricalValidationByVersion(params: {
  from: string;
  to: string;
  horizon: ValidationHorizon;
  mode?: "swing" | "day";
  scope?: AdminValidationScope;
}): Promise<HistoricalValidationByVersionResponse | null> {
  const qs = new URLSearchParams({
    from: params.from,
    to: params.to,
    horizon: params.horizon,
    by_version: "true"
  });
  if (params.mode) qs.set("mode", params.mode);
  if (params.scope === "mine") qs.set("scope", "mine");
  else if (params.scope === "all") qs.set("scope", "all");
  try {
    const response = await fetch(
      `/api/stocvest/admin/historical-validation/summary?${qs.toString()}`,
      { method: "GET", credentials: "include", cache: "no-store" }
    );
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) return null;
    const data = (await response.json()) as unknown;
    if (!isRecord(data)) return null;
    const map = isRecord(data.by_parameter_version) ? data.by_parameter_version : null;
    const horizon = parseHorizon(data.horizon);
    if (!map || !horizon) return null;
    const parsed: HistoricalValidationByVersionResponse["by_parameter_version"] = {};
    for (const [key, value] of Object.entries(map)) {
      const summary = parseSummary(value);
      if (summary) parsed[key] = summary;
    }
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

export async function fetchEnvironmentPolicyBacktest(params: {
  days?: number;
  horizon?: ValidationHorizon;
  mode?: EnvironmentBacktestMode;
  top?: number;
}): Promise<EnvironmentPolicyBacktestResponse | null> {
  const qs = new URLSearchParams();
  if (params.days != null) qs.set("days", String(params.days));
  if (params.horizon) qs.set("horizon", params.horizon);
  if (params.mode) qs.set("mode", params.mode);
  if (params.top != null) qs.set("top", String(params.top));
  try {
    const response = await fetch(
      `/api/stocvest/admin/environment-policy/backtest?${qs.toString()}`,
      { method: "GET", credentials: "include", cache: "no-store" }
    );
    if (response.status === 401 || response.status === 403) {
      void surfaceAuthErrorIfAny(response);
      return null;
    }
    if (!response.ok) return null;
    const data = (await response.json()) as unknown;
    if (!isRecord(data)) return null;
    const horizon = parseHorizon(data.horizon);
    if (!horizon) return null;
    const candidates: EnvironmentBandCandidate[] = [];
    if (Array.isArray(data.candidates)) {
      for (const item of data.candidates) {
        const c = parseCandidate(item);
        if (c) candidates.push(c);
      }
    }
    const prod = isRecord(data.production_bands) ? data.production_bands : null;
    return {
      horizon,
      mode: (data.mode === "day" || data.mode === "all" ? data.mode : "swing") as EnvironmentBacktestMode,
      days: Number(data.days ?? 180),
      from: String(data.from ?? ""),
      to: String(data.to ?? ""),
      rows_total: Number(data.rows_total ?? 0),
      rows_with_vix: Number(data.rows_with_vix ?? 0),
      production_bands: {
        normal_enter: Number(prod?.normal_enter ?? 20),
        elevated_enter: Number(prod?.elevated_enter ?? 28),
        crisis_enter: Number(prod?.crisis_enter ?? 32)
      },
      candidates,
      ranked_count: Number(data.ranked_count ?? candidates.length),
      disclaimer: String(data.disclaimer ?? "")
    };
  } catch {
    return null;
  }
}
