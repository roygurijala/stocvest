"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdminValidationScope } from "@/lib/api/admin-desk-backtest";
import {
  applyProductKpiPromotion,
  fetchAdminProductKpiByVersion,
  fetchAdminProductKpiSummary,
  PRODUCT_KPI_DEFAULT_DAYS,
  PRODUCT_KPI_MIN_RESOLVED,
  type ProductKpiByVersionResponse,
  type ProductKpiResponse,
  type ProductKpiSummary,
  type VersionPromotionVerdict
} from "@/lib/api/admin-product-kpi";
import { fetchProposals, type ProposalSummaryRow } from "@/lib/api/admin-proposals";
import { fetchCurrentParameters } from "@/lib/api/admin-parameters-current";
import {
  ALL_VERSIONS_KEY,
  formatAccuracyPercent,
  type BucketStats,
  type ValidationHorizon
} from "@/lib/api/historical-validation";
import { CuteLoader } from "@/components/cute-loader";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type WindowDays = 30 | 60 | 90 | 180;
type ModeFilter = "swing" | "day";

const WINDOW_OPTIONS: WindowDays[] = [30, 60, 90, 180];
const MODE_OPTIONS: ModeFilter[] = ["swing", "day"];

const SCORE_LABELS: Record<string, string> = {
  below_70: "Score < 70",
  "70_74": "Score 70–74",
  "75_79": "Score 75–79",
  "80_plus": "Score 80+"
};

const ALIGN_LABELS: Record<string, string> = {
  below_52: "Alignment < 0.52",
  "52_60": "Alignment 0.52–0.60",
  "60_plus": "Alignment ≥ 0.60",
  unknown: "Alignment unknown"
};

const ENV_LABELS: Record<string, string> = {
  normal: "VIX normal",
  elevated: "VIX elevated",
  stressed: "VIX stressed",
  crisis: "VIX crisis",
  unknown: "VIX unknown"
};

const READINESS_LABELS: Record<string, string> = {
  high: "High readiness",
  moderate: "Moderate",
  low: "Low"
};

export interface ProductKpiPanelProps {
  adminScope?: AdminValidationScope;
  defaultWindowDays?: WindowDays;
}

function formatPctFromApi(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  return `${pct.toFixed(1)}%`;
}

function FrontierTable({
  title,
  bands,
  labels
}: {
  title: string;
  bands: Record<string, BucketStats>;
  labels: Record<string, string>;
}) {
  const { colors } = useTheme();
  const keys = Object.keys(bands).filter((k) => bands[k].resolved > 0 || bands[k].total_signals > 0);
  if (keys.length === 0) return null;
  return (
    <div>
      <h4 className="m-0 mb-2 text-sm font-semibold" style={{ color: colors.text }}>
        {title}
      </h4>
      <table className="w-full text-left text-xs" style={{ color: colors.textMuted }}>
        <thead>
          <tr>
            <th className="pb-1 font-medium">Band</th>
            <th className="pb-1 font-medium">Resolved</th>
            <th className="pb-1 font-medium">Accuracy</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const b = bands[key];
            return (
              <tr key={key}>
                <td className="py-1 pr-3" style={{ color: colors.text }}>
                  {labels[key] ?? key}
                </td>
                <td className="py-1">{b.correct + b.incorrect}</td>
                <td className="py-1">{formatAccuracyPercent(b.accuracy)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VersionRow({ version, summary }: { version: string; summary: ProductKpiSummary }) {
  const { colors } = useTheme();
  const resolved = summary.accuracy.resolved_non_neutral;
  return (
    <tr style={{ color: colors.textMuted }}>
      <td className="py-1.5 pr-4 font-medium" style={{ color: colors.text }}>
        {version === ALL_VERSIONS_KEY ? "All versions" : version}
      </td>
      <td className="py-1.5 pr-4">{summary.coverage.cohort_rows}</td>
      <td className="py-1.5 pr-4">{resolved}</td>
      <td className="py-1.5">
        {summary.meets_minimum_sample ? (
          formatPctFromApi(summary.accuracy.accuracy_percent)
        ) : (
          <span title={`Need ≥ ${summary.minimum_resolved_required} resolved`}>—</span>
        )}
      </td>
      <td className="py-1.5">{summary.coverage.signals_per_week.toFixed(1)}/wk</td>
    </tr>
  );
}

export function ProductKpiPanel({
  adminScope = "public",
  defaultWindowDays = 90
}: ProductKpiPanelProps) {
  const { colors } = useTheme();
  const [windowDays, setWindowDays] = useState<WindowDays>(defaultWindowDays);
  const [horizon, setHorizon] = useState<ValidationHorizon>("1d");
  const [mode, setMode] = useState<ModeFilter>("swing");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ProductKpiResponse | null>(null);
  const [byVersion, setByVersion] = useState<ProductKpiByVersionResponse | null>(null);
  const [error, setError] = useState(false);
  const [promotePrior, setPromotePrior] = useState("");
  const [promoteCandidate, setPromoteCandidate] = useState("");
  const [promotion, setPromotion] = useState<VersionPromotionVerdict | null>(null);
  const [promotionLoading, setPromotionLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyResult, setApplyResult] = useState<string | null>(null);
  const [proposalId, setProposalId] = useState("");
  const [pendingProposals, setPendingProposals] = useState<ProposalSummaryRow[]>([]);
  const [liveParameterVersion, setLiveParameterVersion] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const [summary, versions] = await Promise.all([
      fetchAdminProductKpiSummary({
        days: windowDays,
        horizon,
        mode,
        scope: adminScope
      }),
      fetchAdminProductKpiByVersion({
        days: windowDays,
        horizon,
        mode,
        scope: adminScope,
        promotePrior: promotePrior || undefined,
        promoteCandidate: promoteCandidate || undefined
      })
    ]);
    setData(summary);
    setByVersion(versions);
    setPromotion(versions?.promotion ?? null);
    setError(!summary);
    setLoading(false);
  }, [windowDays, horizon, mode, adminScope, promotePrior, promoteCandidate]);

  const runPromotionCheck = useCallback(async () => {
    if (!promotePrior || !promoteCandidate || promotePrior === promoteCandidate) return;
    setPromotionLoading(true);
    const versions = await fetchAdminProductKpiByVersion({
      days: windowDays,
      horizon,
      mode,
      scope: adminScope,
      promotePrior,
      promoteCandidate
    });
    setPromotion(versions?.promotion ?? null);
    setPromotionLoading(false);
  }, [windowDays, horizon, mode, adminScope, promotePrior, promoteCandidate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const [list, live] = await Promise.all([
        fetchProposals({ status: "pending", limit: 20 }),
        fetchCurrentParameters()
      ]);
      setPendingProposals(list?.items ?? []);
      setLiveParameterVersion(live?.version ?? null);
    })();
  }, []);

  const matchingProposals = useMemo(() => {
    if (!promotePrior) return pendingProposals;
    const prior = promotePrior.trim();
    const live = (liveParameterVersion ?? "").trim();
    const matched = pendingProposals.filter(
      (p) => p.baseline_parameter_version === prior || (live && p.baseline_parameter_version === live)
    );
    return matched.length > 0 ? matched : pendingProposals;
  }, [promotePrior, pendingProposals, liveParameterVersion]);

  useEffect(() => {
    if (matchingProposals.length === 0) {
      setProposalId("");
      return;
    }
    const stillValid = matchingProposals.some((p) => p.proposal_id === proposalId);
    if (!stillValid) {
      setProposalId(matchingProposals[0].proposal_id);
    }
  }, [matchingProposals, proposalId]);

  const summary = data?.summary;
  const heroAccuracy = useMemo(() => {
    if (!summary) return "—";
    if (!summary.meets_minimum_sample) return "—";
    const pct = formatPctFromApi(summary.accuracy.accuracy_percent);
    const lo = summary.accuracy.accuracy_ci_low_percent;
    const hi = summary.accuracy.accuracy_ci_high_percent;
    if (lo != null && hi != null) {
      return `${pct} (${lo.toFixed(1)}–${hi.toFixed(1)}%)`;
    }
    return pct;
  }, [summary]);

  const runApplyPromotion = useCallback(async () => {
    if (!promotePrior || !promoteCandidate || !proposalId) return;
    setApplyLoading(true);
    setApplyResult(null);
    const result = await applyProductKpiPromotion({
      prior_version: promotePrior,
      candidate_version: promoteCandidate,
      proposal_id: proposalId,
      days: windowDays,
      horizon
    });
    if (!result) {
      setApplyResult("Apply failed — check admin access.");
    } else if (result.success) {
      setApplyResult(`Live parameters updated to ${result.new_parameter_version ?? "new version"}.`);
      void load();
    } else {
      setApplyResult(result.error ?? "Promotion rejected.");
    }
    setApplyLoading(false);
  }, [promotePrior, promoteCandidate, proposalId, windowDays, horizon, load]);

  const versionRows = useMemo(() => {
    if (!byVersion?.by_parameter_version) return [];
    const entries = Object.entries(byVersion.by_parameter_version);
    const all = entries.find(([k]) => k === ALL_VERSIONS_KEY);
    const rest = entries
      .filter(([k]) => k !== ALL_VERSIONS_KEY)
      .sort(([a], [b]) => a.localeCompare(b));
    return all ? [all, ...rest] : rest;
  }, [byVersion]);

  const versionOptions = useMemo(
    () => versionRows.map(([v]) => v).filter((v) => v !== ALL_VERSIONS_KEY),
    [versionRows]
  );

  return (
    <section data-testid="product-kpi-panel" style={{ display: "grid", gap: spacing[4] }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="m-0 text-lg font-semibold" style={{ color: colors.text }}>
            Product KPI
          </h2>
          <p className="m-0 mt-1 max-w-2xl text-xs leading-relaxed" style={{ color: colors.textMuted }}>
            Official scorecard: qualified + actionable + ledger-approved only. Rolling window fixed at
            selection; headline accuracy hidden until ≥ {PRODUCT_KPI_MIN_RESOLVED} resolved non-neutral
            outcomes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <label className="flex items-center gap-1" style={{ color: colors.textMuted }}>
            Window
            <select
              value={windowDays}
              onChange={(e) => setWindowDays(Number(e.target.value) as WindowDays)}
              className="rounded border px-2 py-1 text-xs"
              style={{ borderColor: colors.border, color: colors.text, background: colors.surface }}
            >
              {WINDOW_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}d
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1" style={{ color: colors.textMuted }}>
            Horizon
            <select
              value={horizon}
              onChange={(e) => setHorizon(e.target.value as ValidationHorizon)}
              className="rounded border px-2 py-1 text-xs"
              style={{ borderColor: colors.border, color: colors.text, background: colors.surface }}
            >
              <option value="1d">1d</option>
              <option value="1h">1h</option>
            </select>
          </label>
          <label className="flex items-center gap-1" style={{ color: colors.textMuted }}>
            Mode
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as ModeFilter)}
              className="rounded border px-2 py-1 text-xs"
              style={{ borderColor: colors.border, color: colors.text, background: colors.surface }}
            >
              {MODE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {loading ? (
        <CuteLoader label="Loading product KPI…" />
      ) : error || !summary ? (
        <p className="text-sm" style={{ color: colors.textMuted }}>
          Unable to load product KPI. Check admin access and platform ledger data.
        </p>
      ) : (
        <>
          <div
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
            style={{
              padding: spacing[4],
              borderRadius: borderRadius.lg,
              border: `1px solid ${colors.border}`,
              background: colors.surface
            }}
          >
            <div>
              <p className="m-0 text-xs uppercase tracking-wide" style={{ color: colors.textMuted }}>
                Directional accuracy ({horizon})
              </p>
              <p
                className="m-0 mt-1 font-semibold tabular-nums"
                style={{ fontSize: typography.size2xl, color: colors.text }}
              >
                {heroAccuracy}
              </p>
              {!summary.meets_minimum_sample && (
                <p className="m-0 mt-1 text-xs" style={{ color: colors.textMuted }}>
                  Need {summary.minimum_resolved_required} resolved — have{" "}
                  {summary.coverage.resolved_non_neutral}
                </p>
              )}
            </div>
            {summary.coverage.coverage_low ? (
              <div
                className="sm:col-span-2 lg:col-span-4 rounded-md px-3 py-2 text-xs"
                style={{
                  border: `1px solid ${colors.border}`,
                  color: colors.textMuted,
                  background: colors.surface
                }}
                data-testid="product-kpi-coverage-alert"
              >
                Low signal flow: {summary.coverage.signals_per_week}/wk is below{" "}
                {summary.coverage.min_signals_per_week_warning}/wk — gates may be too tight.
              </div>
            ) : null}
            <div>
              <p className="m-0 text-xs uppercase tracking-wide" style={{ color: colors.textMuted }}>
                Resolved (non-neutral)
              </p>
              <p className="m-0 mt-1 text-xl font-semibold tabular-nums" style={{ color: colors.text }}>
                {summary.coverage.resolved_non_neutral}
              </p>
              <p className="m-0 mt-1 text-xs" style={{ color: colors.textMuted }}>
                {summary.coverage.pending_outcome} pending · {summary.coverage.cohort_rows} cohort
              </p>
            </div>
            <div>
              <p className="m-0 text-xs uppercase tracking-wide" style={{ color: colors.textMuted }}>
                Coverage
              </p>
              <p className="m-0 mt-1 text-xl font-semibold tabular-nums" style={{ color: colors.text }}>
                {summary.coverage.signals_per_week}/wk
              </p>
              <p className="m-0 mt-1 text-xs" style={{ color: colors.textMuted }}>
                {summary.coverage.days_with_signal} days with signals (
                {summary.coverage.day_coverage_pct}% of window)
              </p>
            </div>
            <div>
              <p className="m-0 text-xs uppercase tracking-wide" style={{ color: colors.textMuted }}>
                Window
              </p>
              <p className="m-0 mt-1 text-sm" style={{ color: colors.text }}>
                {windowDays}d rolling
              </p>
              <p className="m-0 mt-1 text-xs font-mono" style={{ color: colors.textMuted }}>
                {data?.from?.slice(0, 10)} → {data?.to?.slice(0, 10)}
              </p>
            </div>
          </div>

          <p className="m-0 text-xs font-mono" style={{ color: colors.textMuted }}>
            {summary.cohort_definition}
          </p>

          <div
            style={{
              display: "grid",
              gap: spacing[4],
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              padding: spacing[3],
              borderRadius: borderRadius.md,
              border: `1px solid ${colors.border}`
            }}
          >
            <FrontierTable
              title="Decision frontier — score"
              bands={summary.by_score_band}
              labels={SCORE_LABELS}
            />
            <FrontierTable
              title="Decision frontier — alignment"
              bands={summary.by_alignment_band}
              labels={ALIGN_LABELS}
            />
            <FrontierTable
              title="Decision frontier — readiness"
              bands={summary.by_readiness_band}
              labels={READINESS_LABELS}
            />
            <FrontierTable
              title="By environment"
              bands={summary.by_environment}
              labels={ENV_LABELS}
            />
          </div>

          {versionOptions.length >= 2 && (
            <div
              style={{
                padding: spacing[3],
                borderRadius: borderRadius.md,
                border: `1px solid ${colors.border}`
              }}
              data-testid="product-kpi-promotion"
            >
              <h3 className="m-0 mb-2 text-sm font-semibold" style={{ color: colors.text }}>
                Version promotion check
              </h3>
              <p className="m-0 mb-3 text-xs" style={{ color: colors.textMuted }}>
                Promote only when accuracy ≥ prior, volume ≥ 80% of prior, and each version has ≥ 30 resolved
                non-neutral rows.
              </p>
              <div className="flex flex-wrap items-end gap-2 text-xs">
                <label className="flex flex-col gap-1" style={{ color: colors.textMuted }}>
                  Prior
                  <select
                    value={promotePrior}
                    onChange={(e) => setPromotePrior(e.target.value)}
                    className="rounded border px-2 py-1"
                    style={{ borderColor: colors.border, color: colors.text, background: colors.surface }}
                  >
                    <option value="">—</option>
                    {versionOptions.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1" style={{ color: colors.textMuted }}>
                  Candidate
                  <select
                    value={promoteCandidate}
                    onChange={(e) => setPromoteCandidate(e.target.value)}
                    className="rounded border px-2 py-1"
                    style={{ borderColor: colors.border, color: colors.text, background: colors.surface }}
                  >
                    <option value="">—</option>
                    {versionOptions.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1" style={{ color: colors.textMuted }}>
                  Pending proposal
                  <select
                    value={proposalId}
                    onChange={(e) => setProposalId(e.target.value)}
                    className="rounded border px-2 py-1 min-w-[12rem]"
                    style={{ borderColor: colors.border, color: colors.text, background: colors.surface }}
                  >
                    <option value="">—</option>
                    {matchingProposals.map((p) => (
                      <option key={p.proposal_id} value={p.proposal_id}>
                        {p.proposal_id.slice(0, 8)}… baseline {p.baseline_parameter_version}
                        {p.baseline_parameter_version === promotePrior ? " ✓" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={promotionLoading || !promotePrior || !promoteCandidate}
                  onClick={() => void runPromotionCheck()}
                  className="rounded px-3 py-1.5 font-medium"
                  style={{
                    background: colors.accent,
                    color: colors.surface,
                    opacity: promotionLoading || !promotePrior || !promoteCandidate ? 0.5 : 1
                  }}
                >
                  {promotionLoading ? "Checking…" : "Evaluate"}
                </button>
                <button
                  type="button"
                  disabled={
                    applyLoading ||
                    !promotion?.promoted ||
                    !proposalId ||
                    !promotePrior ||
                    !promoteCandidate
                  }
                  onClick={() => void runApplyPromotion()}
                  className="rounded border px-3 py-1.5 font-medium"
                  style={{
                    borderColor: colors.border,
                    color: colors.text,
                    opacity:
                      applyLoading || !promotion?.promoted || !proposalId ? 0.5 : 1
                  }}
                >
                  {applyLoading ? "Applying…" : "Apply to live"}
                </button>
              </div>
              {applyResult ? (
                <p className="m-0 mt-2 text-xs" style={{ color: colors.textMuted }}>
                  {applyResult}
                </p>
              ) : null}
              {promotion ? (
                <div className="mt-3 text-xs" style={{ color: colors.textMuted }}>
                  <p className="m-0 font-medium" style={{ color: promotion.promoted ? colors.positive ?? colors.accent : colors.text }}>
                    {promotion.promoted ? "Eligible for promotion" : "Not eligible for promotion"}
                  </p>
                  <p className="m-0 mt-1">
                    {promotion.prior_version} → {promotion.candidate_version}:{" "}
                    {promotion.prior_accuracy_percent ?? "—"}% → {promotion.candidate_accuracy_percent ?? "—"}%
                    (resolved {promotion.prior_resolved} → {promotion.candidate_resolved}
                    {promotion.volume_ratio != null ? `, volume ratio ${(promotion.volume_ratio * 100).toFixed(0)}%` : ""})
                  </p>
                  {promotion.reasons.length > 0 ? (
                    <ul className="m-0 mt-1 list-disc pl-4">
                      {promotion.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          {versionRows.length > 0 && (
            <div>
              <h3 className="m-0 mb-2 text-sm font-semibold" style={{ color: colors.text }}>
                Parameter versions
              </h3>
              <table className="w-full text-left text-xs">
                <thead style={{ color: colors.textMuted }}>
                  <tr>
                    <th className="pb-1 font-medium">Version</th>
                    <th className="pb-1 font-medium">Cohort</th>
                    <th className="pb-1 font-medium">Resolved</th>
                    <th className="pb-1 font-medium">Accuracy</th>
                    <th className="pb-1 font-medium">Flow</th>
                  </tr>
                </thead>
                <tbody>
                  {versionRows.map(([v, s]) => (
                    <VersionRow key={v} version={v} summary={s} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data?.disclaimer && (
            <p className="m-0 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
              {data.disclaimer}
            </p>
          )}
        </>
      )}
    </section>
  );
}
