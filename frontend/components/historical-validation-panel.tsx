"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildTrailingWindow,
  fetchHistoricalValidationSummary,
  formatAccuracyPercent,
  type BucketStats,
  type HistoricalValidationResponse,
  type HistoricalValidationSummary,
  type ValidationHorizon
} from "@/lib/api/historical-validation";
import { CuteLoader } from "@/components/cute-loader";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

/**
 * D2 Historical Signal Validation — Phase 3b UI surface.
 *
 * Renders the six stratifications produced by the backend over a `[from, to)` window,
 * scoped to the calling user via the JWT cookie. The panel is deliberately calm:
 *
 * - No "win rate", no expectancy, no dollar P&L — only directional accuracy, which
 *   the backend defines as `correct / (correct + incorrect)` with neutrals excluded
 *   from the denominator.
 * - A `null` accuracy renders "—" verbatim, never "0%". The wire already serializes
 *   NaN as `null` (`tests/api/handlers/test_signals_historical_validation.py`); the
 *   UI just respects that contract.
 * - The standing disclaimer ("Historical signal accuracy does not guarantee future
 *   results.") is rendered verbatim from the backend response so the wording cannot
 *   drift between the assistant prompt, this panel, and any future public mirror.
 */

type WindowDays = 30 | 60 | 90;
type ModeFilter = "all" | "swing" | "day";

const WINDOW_OPTIONS: WindowDays[] = [30, 60, 90];
const HORIZON_OPTIONS: ValidationHorizon[] = ["1h", "1d"];
const MODE_OPTIONS: ModeFilter[] = ["all", "swing", "day"];

// Friendly labels for the canonical engine vocabulary so the UI doesn't surface raw
// engine tokens (e.g. `risk_on`, `swing_composite`, `actionable`). Unknown keys fall
// through to their raw form rather than being silently dropped.
const BUCKET_LABELS: Record<string, string> = {
  // decision states
  actionable: "Actionable",
  monitor: "Monitor only",
  blocked: "Blocked",
  // macro regimes (engine vocabulary; UI elsewhere maps to Bullish/Neutral/Bearish
  // for marketing copy, but the validation surface keeps the engine form so the
  // backend's `regime_label_at_entry` column is traceable).
  risk_on: "Risk-on",
  neutral: "Neutral",
  risk_off: "Risk-off",
  avoid: "Avoid",
  // trading modes
  swing: "Swing (multi-day)",
  day: "Day (intraday)",
  // pattern families
  swing_composite: "Swing composite",
  orb: "Opening range breakout",
  vwap: "VWAP",
  momentum: "Momentum",
  gap_with_catalyst: "Gap + catalyst",
  // readiness buckets
  high: "High readiness (≥70)",
  moderate: "Moderate readiness (40–69)",
  low: "Low readiness (<40)",
  // direction
  bullish: "Bullish",
  bearish: "Bearish",
  // overflow / fallback buckets — these are produced by Phase 1 when the engine
  // emits a value outside the declared vocabulary. We surface them so the user can
  // see "there was data we couldn't categorize" rather than silently dropping it.
  unknown: "Unknown / legacy",
  other: "Other"
};

function labelFor(key: string): string {
  return BUCKET_LABELS[key] ?? key;
}

interface StratificationConfig {
  key: keyof Pick<
    HistoricalValidationSummary,
    "by_decision" | "by_regime" | "by_mode" | "by_pattern" | "by_readiness" | "by_direction"
  >;
  title: string;
  /** Optional explicit ordering — keys not listed here fall to the end alphabetically. */
  preferredOrder?: string[];
  description: string;
}

const STRATIFICATIONS: StratificationConfig[] = [
  {
    key: "by_decision",
    title: "Decision state at entry",
    preferredOrder: ["actionable", "monitor", "blocked", "unknown"],
    description: "How the synthesis gates resolved when the signal was recorded."
  },
  {
    key: "by_regime",
    title: "Macro regime at entry",
    preferredOrder: ["risk_on", "neutral", "risk_off", "avoid", "unknown"],
    description: "Regime label written by the macro layer at the time of recording."
  },
  {
    key: "by_mode",
    title: "Trading mode",
    preferredOrder: ["swing", "day"],
    description: "Swing decisions evaluate on the daily cadence; day decisions on session-bound rules."
  },
  {
    key: "by_pattern",
    title: "Setup pattern",
    preferredOrder: ["swing_composite", "orb", "vwap", "momentum", "gap_with_catalyst", "other"],
    description: "The setup family that generated the signal."
  },
  {
    key: "by_readiness",
    title: "Trade Readiness bucket",
    preferredOrder: ["high", "moderate", "low"],
    description: "Trade Readiness 0–100 grouped using the Evidence-card thresholds."
  },
  {
    key: "by_direction",
    title: "Direction",
    preferredOrder: ["bullish", "bearish", "neutral"],
    description: "Direction declared at signal time. Neutral signals are tracked but never advised."
  }
];

function orderedBucketEntries(
  map: Record<string, BucketStats>,
  preferred: string[] | undefined
): [string, BucketStats][] {
  const entries = Object.entries(map);
  if (!preferred || preferred.length === 0) {
    return entries.sort((a, b) => a[0].localeCompare(b[0]));
  }
  const rank = new Map(preferred.map((k, i) => [k, i] as const));
  return entries.sort((a, b) => {
    const ra = rank.get(a[0]) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b[0]) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a[0].localeCompare(b[0]);
  });
}

interface BucketBarRowProps {
  label: string;
  stats: BucketStats;
  colors: ReturnType<typeof useTheme>["colors"];
}

function BucketBarRow({ label, stats, colors }: BucketBarRowProps) {
  // Bar width tracks accuracy in [0, 1]. Null accuracy renders an empty track.
  const pct = stats.accuracy == null ? 0 : Math.max(0, Math.min(1, stats.accuracy)) * 100;
  return (
    <div style={{ marginBottom: spacing[3] }} data-testid="historical-validation-bucket">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: spacing[2],
          marginBottom: spacing[1]
        }}
      >
        <span style={{ fontSize: typography.scale.sm, color: colors.text, fontWeight: 600 }}>{label}</span>
        <span
          style={{
            fontSize: typography.scale.sm,
            color: colors.textMuted,
            fontFamily: typography.fontFamilyMono
          }}
        >
          {formatAccuracyPercent(stats.accuracy)}{" "}
          <span style={{ color: colors.textMuted, fontWeight: 400 }}>
            ({stats.correct}/{stats.correct + stats.incorrect})
          </span>
        </span>
      </div>
      <div
        style={{
          height: 6,
          width: "100%",
          background: colors.surfaceMuted,
          borderRadius: borderRadius.full,
          overflow: "hidden"
        }}
        aria-hidden="true"
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: colors.accent,
            transition: "width 240ms ease"
          }}
        />
      </div>
      <div
        style={{
          fontSize: typography.scale.xs,
          color: colors.textMuted,
          marginTop: spacing[1]
        }}
      >
        {stats.total_signals} signal{stats.total_signals === 1 ? "" : "s"}
        {stats.neutral > 0 ? ` · ${stats.neutral} neutral` : ""}
      </div>
    </div>
  );
}

interface StratificationCardProps {
  config: StratificationConfig;
  summary: HistoricalValidationSummary;
  colors: ReturnType<typeof useTheme>["colors"];
}

function StratificationCard({ config, summary, colors }: StratificationCardProps) {
  const entries = orderedBucketEntries(summary[config.key], config.preferredOrder);
  return (
    <section
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        padding: spacing[5]
      }}
    >
      <header style={{ marginBottom: spacing[3] }}>
        <h3
          style={{
            margin: 0,
            fontSize: typography.scale.base,
            color: colors.text,
            fontWeight: 700
          }}
        >
          {config.title}
        </h3>
        <p
          style={{
            margin: `${spacing[1]} 0 0`,
            fontSize: typography.scale.xs,
            color: colors.textMuted,
            lineHeight: 1.55
          }}
        >
          {config.description}
        </p>
      </header>
      {entries.length === 0 ? (
        <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
          No signals in this stratum yet.
        </p>
      ) : (
        entries.map(([key, stats]) => (
          <BucketBarRow key={key} label={labelFor(key)} stats={stats} colors={colors} />
        ))
      )}
    </section>
  );
}

export function HistoricalValidationPanel() {
  const { colors } = useTheme();
  const [horizon, setHorizon] = useState<ValidationHorizon>("1h");
  const [days, setDays] = useState<WindowDays>(30);
  const [mode, setMode] = useState<ModeFilter>("all");
  const [response, setResponse] = useState<HistoricalValidationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthenticated, setUnauthenticated] = useState(false);

  const fetchWindow = useCallback(async (h: ValidationHorizon, d: WindowDays, m: ModeFilter) => {
    setLoading(true);
    setUnauthenticated(false);
    const { from, to } = buildTrailingWindow(d);
    const result = await fetchHistoricalValidationSummary({
      horizon: h,
      from,
      to,
      ...(m === "all" ? {} : { mode: m as "swing" | "day" })
    });
    setResponse(result);
    setUnauthenticated(result === null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchWindow(horizon, days, mode);
  }, [horizon, days, mode, fetchWindow]);

  const summary = response?.summary ?? null;

  const overallSubtitle = useMemo(() => {
    if (!summary) return null;
    const resolved = summary.overall.correct + summary.overall.incorrect;
    if (resolved === 0) return "No resolved trades in this window yet.";
    return `${summary.overall.correct} correct of ${resolved} resolved (neutrals excluded from the denominator)`;
  }, [summary]);

  return (
    <div data-testid="historical-validation-panel">
      <section style={{ marginBottom: spacing[5] }}>
        <h2
          style={{
            margin: 0,
            fontSize: typography.scale.xl,
            color: colors.text,
            fontWeight: 700
          }}
        >
          Historical signal validation
        </h2>
        <p
          style={{
            margin: `${spacing[2]} 0 0`,
            fontSize: typography.scale.sm,
            color: colors.textMuted,
            lineHeight: 1.6,
            maxWidth: 720
          }}
        >
          Directional accuracy of real signals that STOCVEST emitted, resolved against later
          prices — nothing here is simulated and nothing here is a forecast.
        </p>
      </section>

      {/* Filter bar */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: spacing[4],
          alignItems: "center",
          marginBottom: spacing[5]
        }}
      >
        <FilterGroup
          label="Horizon"
          options={HORIZON_OPTIONS.map((h) => ({ value: h, label: h === "1h" ? "1 hour" : "1 day" }))}
          value={horizon}
          onChange={(v) => setHorizon(v as ValidationHorizon)}
          colors={colors}
          testId="hv-horizon"
        />
        <FilterGroup
          label="Window"
          options={WINDOW_OPTIONS.map((d) => ({ value: String(d), label: `${d} days` }))}
          value={String(days)}
          onChange={(v) => setDays(Number(v) as WindowDays)}
          colors={colors}
          testId="hv-window"
        />
        <FilterGroup
          label="Mode"
          options={MODE_OPTIONS.map((m) => ({
            value: m,
            label: m === "all" ? "All" : m === "swing" ? "Swing" : "Day"
          }))}
          value={mode}
          onChange={(v) => setMode(v as ModeFilter)}
          colors={colors}
          testId="hv-mode"
        />
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: spacing[10] }}>
          <CuteLoader label="Loading historical accuracy…" />
        </div>
      ) : unauthenticated ? (
        <p style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>
          Sign in to view your historical signal validation.
        </p>
      ) : summary === null ? (
        <p style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>
          No data available for this window.
        </p>
      ) : (
        <>
          {/* Overall hero card */}
          <section
            className={surfaceGlowClassName}
            style={{
              borderRadius: borderRadius.lg,
              border: `1px solid ${colors.border}`,
              padding: spacing[5],
              marginBottom: spacing[5],
              background: colors.surface
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: spacing[4] }}>
              <div>
                <div
                  style={{
                    fontSize: typography.scale.xs,
                    color: colors.textMuted,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: spacing[1]
                  }}
                >
                  Overall directional accuracy
                </div>
                <div
                  data-testid="hv-overall-accuracy"
                  style={{
                    fontSize: typography.scale["3xl"],
                    color: colors.text,
                    fontWeight: 700,
                    fontFamily: typography.fontFamilyMono
                  }}
                >
                  {formatAccuracyPercent(summary.overall.accuracy)}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div
                  style={{
                    fontSize: typography.scale.sm,
                    color: colors.text,
                    lineHeight: 1.6,
                    marginBottom: spacing[1]
                  }}
                >
                  {overallSubtitle}
                </div>
                <div style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
                  {summary.rows_examined} signal{summary.rows_examined === 1 ? "" : "s"} examined
                  {summary.parameter_versions.length > 0
                    ? ` · parameter ${summary.parameter_versions.length === 1 ? "version" : "versions"} ${summary.parameter_versions.join(", ")}`
                    : ""}
                </div>
              </div>
            </div>
          </section>

          {/* Stratification grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: spacing[4],
              marginBottom: spacing[5]
            }}
          >
            {STRATIFICATIONS.map((config) => (
              <StratificationCard key={config.key} config={config} summary={summary} colors={colors} />
            ))}
          </div>

          {/* Disclaimer — rendered verbatim from the backend response */}
          {response?.disclaimer ? (
            <p
              data-testid="hv-disclaimer"
              style={{
                margin: 0,
                fontSize: typography.scale.xs,
                color: colors.textMuted,
                lineHeight: 1.6,
                fontStyle: "italic"
              }}
            >
              {response.disclaimer}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

// ── Small private filter component ─────────────────────────────────────────────────

interface FilterGroupProps {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (next: string) => void;
  colors: ReturnType<typeof useTheme>["colors"];
  testId?: string;
}

function FilterGroup({ label, options, value, onChange, colors, testId }: FilterGroupProps) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: spacing[2] }} data-testid={testId}>
      <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: `${spacing[1]} ${spacing[2]}`,
          borderRadius: borderRadius.md,
          border: `1px solid ${colors.border}`,
          background: colors.surface,
          color: colors.text,
          fontSize: typography.scale.sm
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
