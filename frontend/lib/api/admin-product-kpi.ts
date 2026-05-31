"use client";

import { surfaceAuthErrorIfAny } from "@/lib/auth/surface-auth-error";
import type { AdminValidationScope } from "@/lib/api/admin-desk-backtest";
import {
  parseHorizon,
  parseEchoedString,
  parseEchoedMode,
  parseDisclaimer,
  type BucketStats,
  type ValidationHorizon
} from "@/lib/api/historical-validation";

export const PRODUCT_KPI_MIN_RESOLVED = 50;
export const PRODUCT_KPI_DEFAULT_DAYS = 90;

export interface ProductKpiCoverage {
  window_calendar_days: number;
  cohort_rows: number;
  pending_outcome: number;
  resolved_non_neutral: number;
  signals_per_week: number;
  days_with_signal: number;
  day_coverage_pct: number;
  trading_days_in_window: number;
  days_with_signal_et: number;
  trading_day_coverage_pct: number;
  coverage_low: boolean;
  min_signals_per_week_warning: number;
}

export interface ProductKpiAccuracy extends BucketStats {
  accuracy_percent: number | null;
  accuracy_ci_low_percent: number | null;
  accuracy_ci_high_percent: number | null;
  resolved_non_neutral: number;
}

export interface ApplyPromotionResult {
  success: boolean;
  action: string;
  promotion: VersionPromotionVerdict;
  new_parameter_version: string | null;
  proposal_id: string | null;
  error: string | null;
}

export interface ProductKpiSummary {
  horizon: ValidationHorizon;
  cohort_definition: string;
  meets_minimum_sample: boolean;
  minimum_resolved_required: number;
  accuracy: ProductKpiAccuracy;
  coverage: ProductKpiCoverage;
  by_score_band: Record<string, BucketStats>;
  by_alignment_band: Record<string, BucketStats>;
  by_readiness_band: Record<string, BucketStats>;
  by_environment: Record<string, BucketStats>;
  parameter_versions: string[];
}

export interface VersionPromotionVerdict {
  candidate_version: string;
  prior_version: string;
  promoted: boolean;
  reasons: string[];
  candidate_resolved: number;
  prior_resolved: number;
  candidate_accuracy_percent: number | null;
  prior_accuracy_percent: number | null;
  volume_ratio: number | null;
}

export interface ProductKpiResponse {
  horizon: ValidationHorizon;
  from: string;
  to: string;
  days: number;
  mode: "swing" | "day" | null;
  scope: AdminValidationScope;
  cohort_definition: string;
  disclaimer: string;
  summary: ProductKpiSummary;
}

export interface ProductKpiByVersionResponse extends Omit<ProductKpiResponse, "summary"> {
  by_parameter_version: Record<string, ProductKpiSummary>;
  promotion?: VersionPromotionVerdict;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseBucketStats(raw: unknown): BucketStats | null {
  if (!isRecord(raw)) return null;
  const accuracy = raw.accuracy;
  return {
    total_signals: Number(raw.total_signals ?? 0),
    correct: Number(raw.correct ?? 0),
    incorrect: Number(raw.incorrect ?? 0),
    neutral: Number(raw.neutral ?? 0),
    resolved: Number(raw.resolved ?? 0),
    accuracy: accuracy === null || accuracy === undefined ? null : Number(accuracy)
  };
}

function parseProductKpiSummary(raw: unknown): ProductKpiSummary | null {
  if (!isRecord(raw)) return null;
  const accuracyRaw = isRecord(raw.accuracy) ? raw.accuracy : null;
  const coverageRaw = isRecord(raw.coverage) ? raw.coverage : null;
  const base = accuracyRaw ? parseBucketStats(accuracyRaw) : null;
  if (!base || !coverageRaw || !accuracyRaw) return null;

  const parseBandMap = (m: unknown): Record<string, BucketStats> => {
    if (!isRecord(m)) return {};
    const out: Record<string, BucketStats> = {};
    for (const [k, v] of Object.entries(m)) {
      const b = parseBucketStats(v);
      if (b) out[k] = b;
    }
    return out;
  };

  const horizon = parseHorizon(raw.horizon);
  if (!horizon) return null;

  return {
    horizon,
    cohort_definition: String(raw.cohort_definition ?? ""),
    meets_minimum_sample: Boolean(raw.meets_minimum_sample),
    minimum_resolved_required: Number(raw.minimum_resolved_required ?? PRODUCT_KPI_MIN_RESOLVED),
    accuracy: {
      ...base,
      accuracy_percent:
        accuracyRaw.accuracy_percent === null || accuracyRaw.accuracy_percent === undefined
          ? null
          : Number(accuracyRaw.accuracy_percent),
      accuracy_ci_low_percent:
        accuracyRaw.accuracy_ci_low_percent === null ||
        accuracyRaw.accuracy_ci_low_percent === undefined
          ? null
          : Number(accuracyRaw.accuracy_ci_low_percent),
      accuracy_ci_high_percent:
        accuracyRaw.accuracy_ci_high_percent === null ||
        accuracyRaw.accuracy_ci_high_percent === undefined
          ? null
          : Number(accuracyRaw.accuracy_ci_high_percent),
      resolved_non_neutral: Number(accuracyRaw.resolved_non_neutral ?? 0)
    },
    coverage: {
      window_calendar_days: Number(coverageRaw.window_calendar_days ?? 0),
      cohort_rows: Number(coverageRaw.cohort_rows ?? 0),
      pending_outcome: Number(coverageRaw.pending_outcome ?? 0),
      resolved_non_neutral: Number(coverageRaw.resolved_non_neutral ?? 0),
      signals_per_week: Number(coverageRaw.signals_per_week ?? 0),
      days_with_signal: Number(coverageRaw.days_with_signal ?? 0),
      day_coverage_pct: Number(coverageRaw.day_coverage_pct ?? 0),
      trading_days_in_window: Number(coverageRaw.trading_days_in_window ?? 0),
      days_with_signal_et: Number(coverageRaw.days_with_signal_et ?? 0),
      trading_day_coverage_pct: Number(coverageRaw.trading_day_coverage_pct ?? 0),
      coverage_low: Boolean(coverageRaw.coverage_low),
      min_signals_per_week_warning: Number(coverageRaw.min_signals_per_week_warning ?? 2)
    },
    by_score_band: parseBandMap(raw.by_score_band),
    by_alignment_band: parseBandMap(raw.by_alignment_band),
    by_readiness_band: parseBandMap(raw.by_readiness_band),
    by_environment: parseBandMap(raw.by_environment),
    parameter_versions: Array.isArray(raw.parameter_versions)
      ? raw.parameter_versions.map(String)
      : []
  };
}

export async function fetchAdminProductKpiSummary(params: {
  days?: number;
  horizon?: ValidationHorizon;
  mode?: "swing" | "day";
  scope?: AdminValidationScope;
}): Promise<ProductKpiResponse | null> {
  const qs = new URLSearchParams();
  qs.set("days", String(params.days ?? PRODUCT_KPI_DEFAULT_DAYS));
  if (params.horizon) qs.set("horizon", params.horizon);
  if (params.mode) qs.set("mode", params.mode);
  if (params.scope === "mine") qs.set("scope", "mine");
  else if (params.scope === "all") qs.set("scope", "all");

  try {
    const response = await fetch(`/api/stocvest/admin/product-kpi/summary?${qs}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });
    if (response.status === 401 || response.status === 403) {
      void surfaceAuthErrorIfAny(response);
      return null;
    }
    if (!response.ok) return null;
    const data = (await response.json()) as unknown;
    if (!isRecord(data)) return null;
    const summary = parseProductKpiSummary(data.summary);
    const horizon = parseHorizon(data.horizon);
    if (!summary || !horizon) return null;
    return {
      horizon,
      from: parseEchoedString(data.from) ?? "",
      to: parseEchoedString(data.to) ?? "",
      days: Number(data.days ?? PRODUCT_KPI_DEFAULT_DAYS),
      mode: parseEchoedMode(data.mode),
      scope: (data.scope === "mine" || data.scope === "all" ? data.scope : "public") as AdminValidationScope,
      cohort_definition: String(data.cohort_definition ?? ""),
      disclaimer: parseDisclaimer(data.disclaimer),
      summary
    };
  } catch {
    return null;
  }
}

export async function fetchAdminProductKpiByVersion(params: {
  days?: number;
  horizon?: ValidationHorizon;
  mode?: "swing" | "day";
  scope?: AdminValidationScope;
  promotePrior?: string;
  promoteCandidate?: string;
}): Promise<ProductKpiByVersionResponse | null> {
  const qs = new URLSearchParams();
  qs.set("days", String(params.days ?? PRODUCT_KPI_DEFAULT_DAYS));
  qs.set("by_version", "true");
  if (params.horizon) qs.set("horizon", params.horizon);
  if (params.mode) qs.set("mode", params.mode);
  if (params.scope === "mine") qs.set("scope", "mine");
  else if (params.scope === "all") qs.set("scope", "all");
  if (params.promotePrior) qs.set("promote_prior", params.promotePrior);
  if (params.promoteCandidate) qs.set("promote_candidate", params.promoteCandidate);

  try {
    const response = await fetch(`/api/stocvest/admin/product-kpi/summary?${qs}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) return null;
    const data = (await response.json()) as unknown;
    if (!isRecord(data)) return null;
    const map = isRecord(data.by_parameter_version) ? data.by_parameter_version : null;
    const horizon = parseHorizon(data.horizon);
    if (!map || !horizon || !map.__all__) return null;
    const parsed: Record<string, ProductKpiSummary> = {};
    for (const [key, value] of Object.entries(map)) {
      const s = parseProductKpiSummary(value);
      if (s) parsed[key] = s;
    }
    let promotion: VersionPromotionVerdict | undefined;
    if (isRecord(data.promotion)) {
      const p = data.promotion;
      promotion = {
        candidate_version: String(p.candidate_version ?? ""),
        prior_version: String(p.prior_version ?? ""),
        promoted: Boolean(p.promoted),
        reasons: Array.isArray(p.reasons) ? p.reasons.map(String) : [],
        candidate_resolved: Number(p.candidate_resolved ?? 0),
        prior_resolved: Number(p.prior_resolved ?? 0),
        candidate_accuracy_percent:
          p.candidate_accuracy_percent === null ? null : Number(p.candidate_accuracy_percent),
        prior_accuracy_percent:
          p.prior_accuracy_percent === null ? null : Number(p.prior_accuracy_percent),
        volume_ratio: p.volume_ratio === null ? null : Number(p.volume_ratio)
      };
    }
    return {
      horizon,
      from: parseEchoedString(data.from) ?? "",
      to: parseEchoedString(data.to) ?? "",
      days: Number(data.days ?? PRODUCT_KPI_DEFAULT_DAYS),
      mode: parseEchoedMode(data.mode),
      scope: (data.scope === "mine" || data.scope === "all" ? data.scope : "public") as AdminValidationScope,
      cohort_definition: String(data.cohort_definition ?? ""),
      disclaimer: parseDisclaimer(data.disclaimer),
      by_parameter_version: parsed,
      promotion
    };
  } catch {
    return null;
  }
}

export async function applyProductKpiPromotion(params: {
  prior_version: string;
  candidate_version: string;
  proposal_id: string;
  days?: number;
  horizon?: ValidationHorizon;
}): Promise<ApplyPromotionResult | null> {
  try {
    const response = await fetch(`/api/stocvest/admin/product-kpi/apply-promotion`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prior_version: params.prior_version,
        candidate_version: params.candidate_version,
        proposal_id: params.proposal_id,
        days: params.days ?? PRODUCT_KPI_DEFAULT_DAYS,
        horizon: params.horizon ?? "1d"
      })
    });
    if (response.status === 401 || response.status === 403) {
      void surfaceAuthErrorIfAny(response);
      return null;
    }
    const data = (await response.json()) as unknown;
    if (!isRecord(data)) return null;
    const promotionRaw = isRecord(data.promotion) ? data.promotion : null;
    if (!promotionRaw) return null;
    return {
      success: Boolean(data.success),
      action: String(data.action ?? ""),
      proposal_id: data.proposal_id === null ? null : String(data.proposal_id ?? ""),
      new_parameter_version:
        data.new_parameter_version === null ? null : String(data.new_parameter_version ?? ""),
      error: data.error === null || data.error === undefined ? null : String(data.error),
      promotion: {
        candidate_version: String(promotionRaw.candidate_version ?? ""),
        prior_version: String(promotionRaw.prior_version ?? ""),
        promoted: Boolean(promotionRaw.promoted),
        reasons: Array.isArray(promotionRaw.reasons) ? promotionRaw.reasons.map(String) : [],
        candidate_resolved: Number(promotionRaw.candidate_resolved ?? 0),
        prior_resolved: Number(promotionRaw.prior_resolved ?? 0),
        candidate_accuracy_percent:
          promotionRaw.candidate_accuracy_percent === null
            ? null
            : Number(promotionRaw.candidate_accuracy_percent),
        prior_accuracy_percent:
          promotionRaw.prior_accuracy_percent === null
            ? null
            : Number(promotionRaw.prior_accuracy_percent),
        volume_ratio: promotionRaw.volume_ratio === null ? null : Number(promotionRaw.volume_ratio)
      }
    };
  } catch {
    return null;
  }
}
