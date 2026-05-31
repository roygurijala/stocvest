"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { CuteLoader } from "@/components/cute-loader";
import {
  fetchEnvironmentPolicyBacktest,
  type EnvironmentBacktestMode,
  type EnvironmentBandCandidate,
  type EnvironmentPolicyBacktestResponse
} from "@/lib/api/admin-desk-backtest";
import type { ValidationHorizon } from "@/lib/api/historical-validation";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

const DAY_OPTIONS = [90, 180, 365] as const;
const HORIZON_OPTIONS: ValidationHorizon[] = ["1h", "1d"];
const MODE_OPTIONS: EnvironmentBacktestMode[] = ["swing", "day", "all"];

function formatPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

function sliceForMode(
  row: EnvironmentBandCandidate,
  mode: EnvironmentBacktestMode
): EnvironmentBandCandidate["swing"] {
  return mode === "day" ? row.day : row.swing;
}

export function EnvironmentPolicyBacktestPanel() {
  const { colors } = useTheme();
  const [days, setDays] = useState<(typeof DAY_OPTIONS)[number]>(180);
  const [horizon, setHorizon] = useState<ValidationHorizon>("1d");
  const [mode, setMode] = useState<EnvironmentBacktestMode>("swing");
  const [data, setData] = useState<EnvironmentPolicyBacktestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchEnvironmentPolicyBacktest({ days, horizon, mode, top: 25 });
    setData(result);
    setLoading(false);
    if (result === null) {
      setError("Failed to load environment policy backtest. Confirm admin access and retry.");
    }
  }, [days, horizon, mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const deskMode = mode === "all" ? "swing" : mode;

  return (
    <section
      data-testid="environment-policy-backtest-panel"
      style={{ display: "grid", gap: spacing[4] }}
    >
      <header>
        <h2 className="m-0 text-xl font-semibold" style={{ color: colors.text }}>
          VIX environment policy replay
        </h2>
        <p className="m-0 mt-2 max-w-3xl text-sm leading-relaxed" style={{ color: colors.textMuted }}>
          Replays stored <code>market_environment_audit</code> rows from the public ledger. Tunes enter
          bands only — hysteresis is not simulated. Ranked by allowed-subset accuracy for the selected
          desk mode.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm" style={{ color: colors.textMuted }}>
          Window
          <select
            value={String(days)}
            onChange={(e) => setDays(Number(e.target.value) as (typeof DAY_OPTIONS)[number])}
            className="rounded-md border px-2 py-1 text-sm"
            style={{ borderColor: colors.border, color: colors.text, background: colors.surface }}
          >
            {DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm" style={{ color: colors.textMuted }}>
          Horizon
          <select
            value={horizon}
            onChange={(e) => setHorizon(e.target.value as ValidationHorizon)}
            className="rounded-md border px-2 py-1 text-sm"
            style={{ borderColor: colors.border, color: colors.text, background: colors.surface }}
          >
            {HORIZON_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm" style={{ color: colors.textMuted }}>
          Desk
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as EnvironmentBacktestMode)}
            className="rounded-md border px-2 py-1 text-sm"
            style={{ borderColor: colors.border, color: colors.text, background: colors.surface }}
          >
            {MODE_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm"
          style={{ borderColor: colors.border, color: colors.text }}
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {loading ? (
        <CuteLoader label="Running environment policy grid…" />
      ) : error ? (
        <p style={{ color: colors.bearish, margin: 0 }}>{error}</p>
      ) : data ? (
        <>
          <p className="m-0 text-sm" style={{ color: colors.textMuted }}>
            {data.rows_with_vix} rows with VIX audit (of {data.rows_total} replayable) · production bands{" "}
            {data.production_bands.normal_enter}/{data.production_bands.elevated_enter}/
            {data.production_bands.crisis_enter} · showing top {data.candidates.length} of{" "}
            {data.ranked_count} candidates
          </p>
          <div style={{ overflowX: "auto" }}>
            <table
              className="w-full text-left text-sm"
              style={{ borderCollapse: "collapse", minWidth: 720 }}
            >
              <thead>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                  {["Bands (n/e/c)", "Allowed acc.", "Blocked acc.", "Block %", "Tier match", ""].map(
                    (h) => (
                      <th
                        key={h}
                        className="py-2 pr-4 font-medium"
                        style={{ color: colors.textMuted, fontSize: typography.scale.xs }}
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {data.candidates.map((row) => {
                  const slice = sliceForMode(row, deskMode);
                  return (
                    <tr
                      key={row.config_key}
                      style={{
                        borderBottom: `1px solid ${colors.border}`,
                        background: row.is_production ? `${colors.accent}12` : undefined
                      }}
                    >
                      <td className="py-2 pr-4 font-mono text-xs" style={{ color: colors.text }}>
                        {row.bands.normal_enter}/{row.bands.elevated_enter}/{row.bands.crisis_enter}
                      </td>
                      <td className="py-2 pr-4" style={{ color: colors.text }}>
                        {formatPct(slice.allowed_accuracy_pct)}{" "}
                        <span style={{ color: colors.textMuted }}>
                          ({slice.allowed_correct}/{slice.allowed_resolved})
                        </span>
                      </td>
                      <td className="py-2 pr-4" style={{ color: colors.text }}>
                        {formatPct(slice.blocked_accuracy_pct)}{" "}
                        <span style={{ color: colors.textMuted }}>
                          ({slice.blocked_correct}/{slice.blocked_resolved})
                        </span>
                      </td>
                      <td className="py-2 pr-4" style={{ color: colors.text }}>
                        {formatPct(slice.block_rate_pct)}
                      </td>
                      <td className="py-2 pr-4" style={{ color: colors.text }}>
                        {formatPct(row.tier_agreement_pct)}
                      </td>
                      <td className="py-2 pr-4 text-xs" style={{ color: colors.accent }}>
                        {row.is_production ? "live" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data.disclaimer ? (
            <p className="m-0 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
              {data.disclaimer}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
