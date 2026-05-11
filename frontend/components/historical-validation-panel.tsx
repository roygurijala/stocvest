"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ALL_VERSIONS_KEY,
  buildTrailingWindow,
  defaultCompareSelection,
  diffBucketStats,
  fetchHistoricalValidationByVersion,
  fetchHistoricalValidationSummary,
  formatAccuracyDelta,
  formatAccuracyPercent,
  selectComparableVersions,
  SMALL_SAMPLE_THRESHOLD,
  type BucketDelta,
  type BucketStats,
  type HistoricalValidationByVersionResponse,
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
  // Phase 4 — cross-version compare toggle. Off by default so the panel still opens to
  // the calm single-version overview; the user opts into the more detailed A-vs-B view.
  const [compare, setCompare] = useState(false);
  const [response, setResponse] = useState<HistoricalValidationResponse | null>(null);
  const [byVersion, setByVersion] = useState<HistoricalValidationByVersionResponse | null>(null);
  // The A / B selections live alongside the data fetch — `null` until the user opens
  // compare mode and the by-version fetch resolves with ≥ 2 comparable versions.
  const [versionA, setVersionA] = useState<string | null>(null);
  const [versionB, setVersionB] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthenticated, setUnauthenticated] = useState(false);

  const fetchWindow = useCallback(
    async (h: ValidationHorizon, d: WindowDays, m: ModeFilter, cmp: boolean) => {
      setLoading(true);
      setUnauthenticated(false);
      const { from, to } = buildTrailingWindow(d);
      const params = {
        horizon: h,
        from,
        to,
        ...(m === "all" ? {} : { mode: m as "swing" | "day" })
      };
      if (cmp) {
        const result = await fetchHistoricalValidationByVersion(params);
        setByVersion(result);
        setResponse(null);
        setUnauthenticated(result === null);
        if (result) {
          // Pick a sensible default A / B from the freshly-fetched map. When the user
          // already has explicit selections that still exist in the new window, keep
          // them; otherwise fall back to the "last two" default. This avoids the
          // dropdowns silently jumping when the user just changes the horizon or
          // window length while staying in compare mode.
          const comparable = selectComparableVersions(result.by_parameter_version);
          const keepA = versionA && comparable.includes(versionA) ? versionA : null;
          const keepB = versionB && comparable.includes(versionB) ? versionB : null;
          if (keepA && keepB && keepA !== keepB) {
            setVersionA(keepA);
            setVersionB(keepB);
          } else {
            const def = defaultCompareSelection(result.by_parameter_version);
            setVersionA(def?.versionA ?? null);
            setVersionB(def?.versionB ?? null);
          }
        } else {
          setVersionA(null);
          setVersionB(null);
        }
      } else {
        const result = await fetchHistoricalValidationSummary(params);
        setResponse(result);
        setByVersion(null);
        setUnauthenticated(result === null);
      }
      setLoading(false);
    },
    // versionA / versionB intentionally omitted from deps: the function reads the
    // current values at call time, and including them would re-fetch every time the
    // user changes a dropdown (which is a pure local state change, not a refetch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    void fetchWindow(horizon, days, mode, compare);
  }, [horizon, days, mode, compare, fetchWindow]);

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
        {/* Phase 4 — Compare versions toggle. Sits beside the existing filters so the
            user understands compare mode is just another lens on the same window, not
            a separate page. */}
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: spacing[2],
            cursor: "pointer",
            userSelect: "none"
          }}
          data-testid="hv-compare-toggle"
        >
          <input
            type="checkbox"
            checked={compare}
            onChange={(e) => setCompare(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          <span
            style={{
              fontSize: typography.scale.xs,
              color: colors.textMuted,
              textTransform: "uppercase",
              letterSpacing: "0.05em"
            }}
          >
            Compare versions
          </span>
        </label>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: spacing[10] }}>
          <CuteLoader label="Loading historical accuracy…" />
        </div>
      ) : unauthenticated ? (
        <p style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>
          Sign in to view your historical signal validation.
        </p>
      ) : compare ? (
        <CompareBody
          byVersion={byVersion}
          versionA={versionA}
          versionB={versionB}
          onSelectA={setVersionA}
          onSelectB={setVersionB}
          colors={colors}
        />
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

// ── Phase 4 — Compare-versions body ────────────────────────────────────────────────

interface CompareBodyProps {
  byVersion: HistoricalValidationByVersionResponse | null;
  versionA: string | null;
  versionB: string | null;
  onSelectA: (next: string) => void;
  onSelectB: (next: string) => void;
  colors: ReturnType<typeof useTheme>["colors"];
}

/**
 * Compare-mode body. Renders A / B / Δ for the overall hero card and every
 * stratification card. The math lives in `lib/api/historical-validation.ts::diffBucketStats`
 * so it can be unit-tested directly without rendering.
 *
 * Empty / impossible states the body handles inline:
 * - The whole window is empty (`byVersion === null`): "No data available …".
 * - Fewer than two comparable versions in the window: a calm "need at least two
 *   parameter versions" message. The `__all__` aggregate is intentionally not
 *   selectable as a side of the diff (offering it would create the misleading
 *   "compare a version against the average that includes it" scenario).
 * - The user has selected the same version on both sides (which can happen after a
 *   window-narrowing refetch invalidates one of the two prior choices): a banner
 *   nudging them to pick a different version on side B.
 */
function CompareBody({
  byVersion,
  versionA,
  versionB,
  onSelectA,
  onSelectB,
  colors
}: CompareBodyProps) {
  if (!byVersion) {
    return (
      <p style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>
        No data available for this window.
      </p>
    );
  }

  const comparable = selectComparableVersions(byVersion.by_parameter_version);
  if (comparable.length < 2) {
    return (
      <p
        data-testid="hv-compare-not-enough-versions"
        style={{ color: colors.textMuted, fontSize: typography.scale.sm, lineHeight: 1.6 }}
      >
        Need at least two parameter versions in this window to compare. STOCVEST
        observed {comparable.length === 0 ? "no" : "only one"} stamped version here —
        widen the window to a longer trailing period to span a rules change.
      </p>
    );
  }

  const summaryA = versionA ? byVersion.by_parameter_version[versionA] ?? null : null;
  const summaryB = versionB ? byVersion.by_parameter_version[versionB] ?? null : null;
  const sameSide = versionA !== null && versionA === versionB;

  return (
    <div data-testid="hv-compare-body">
      {/* Version selectors */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: spacing[4],
          marginBottom: spacing[4]
        }}
      >
        <FilterGroup
          label="Version A"
          options={comparable.map((v) => ({ value: v, label: labelForVersion(v) }))}
          value={versionA ?? ""}
          onChange={onSelectA}
          colors={colors}
          testId="hv-compare-version-a"
        />
        <FilterGroup
          label="Version B"
          options={comparable.map((v) => ({ value: v, label: labelForVersion(v) }))}
          value={versionB ?? ""}
          onChange={onSelectB}
          colors={colors}
          testId="hv-compare-version-b"
        />
      </div>

      {sameSide ? (
        <p
          data-testid="hv-compare-same-version"
          style={{
            color: colors.textMuted,
            fontSize: typography.scale.sm,
            fontStyle: "italic",
            marginBottom: spacing[4]
          }}
        >
          Both sides point to the same parameter version — pick a different version on
          either side to see a delta.
        </p>
      ) : null}

      {summaryA && summaryB ? (
        <>
          <CompareOverallCard
            versionA={versionA!}
            versionB={versionB!}
            summaryA={summaryA}
            summaryB={summaryB}
            colors={colors}
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
              gap: spacing[4],
              marginBottom: spacing[5]
            }}
          >
            {STRATIFICATIONS.map((config) => (
              <CompareStratificationCard
                key={config.key}
                config={config}
                summaryA={summaryA}
                summaryB={summaryB}
                colors={colors}
              />
            ))}
          </div>
        </>
      ) : null}

      {byVersion.disclaimer ? (
        <p
          data-testid="hv-compare-disclaimer"
          style={{
            margin: 0,
            fontSize: typography.scale.xs,
            color: colors.textMuted,
            lineHeight: 1.6,
            fontStyle: "italic"
          }}
        >
          {byVersion.disclaimer}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Render a parameter_version key for a dropdown option. `unknown` gets an explanatory
 * label so the user is not confused by a bare token; `__all__` should never appear
 * here (`selectComparableVersions` filters it out) but we defensively handle it too.
 */
function labelForVersion(version: string): string {
  if (version === "unknown") return "unknown (legacy / unstamped)";
  if (version === ALL_VERSIONS_KEY) return "All versions (combined)";
  return version;
}

interface CompareOverallCardProps {
  versionA: string;
  versionB: string;
  summaryA: HistoricalValidationSummary;
  summaryB: HistoricalValidationSummary;
  colors: ReturnType<typeof useTheme>["colors"];
}

function CompareOverallCard({
  versionA,
  versionB,
  summaryA,
  summaryB,
  colors
}: CompareOverallCardProps) {
  const delta = diffBucketStats(summaryA.overall, summaryB.overall);
  return (
    <section
      className={surfaceGlowClassName}
      data-testid="hv-compare-overall-card"
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        padding: spacing[5],
        marginBottom: spacing[5],
        background: colors.surface
      }}
    >
      <div
        style={{
          fontSize: typography.scale.xs,
          color: colors.textMuted,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: spacing[3]
        }}
      >
        Overall directional accuracy
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: spacing[4]
        }}
      >
        <OverallColumn
          headline={`${labelForVersion(versionA)} (A)`}
          accuracy={summaryA.overall.accuracy}
          resolved={summaryA.overall.correct + summaryA.overall.incorrect}
          correct={summaryA.overall.correct}
          rowsExamined={summaryA.rows_examined}
          colors={colors}
          smallSample={delta.smallSampleA}
        />
        <OverallColumn
          headline={`${labelForVersion(versionB)} (B)`}
          accuracy={summaryB.overall.accuracy}
          resolved={summaryB.overall.correct + summaryB.overall.incorrect}
          correct={summaryB.overall.correct}
          rowsExamined={summaryB.rows_examined}
          colors={colors}
          smallSample={delta.smallSampleB}
        />
        <DeltaColumn delta={delta} colors={colors} />
      </div>
    </section>
  );
}

interface OverallColumnProps {
  headline: string;
  accuracy: number | null;
  resolved: number;
  correct: number;
  rowsExamined: number;
  colors: ReturnType<typeof useTheme>["colors"];
  smallSample: boolean;
}

function OverallColumn({
  headline,
  accuracy,
  resolved,
  correct,
  rowsExamined,
  colors,
  smallSample
}: OverallColumnProps) {
  return (
    <div>
      <div
        style={{
          fontSize: typography.scale.xs,
          color: colors.textMuted,
          marginBottom: spacing[1]
        }}
      >
        {headline}
      </div>
      <div
        style={{
          fontSize: typography.scale["2xl"],
          color: colors.text,
          fontWeight: 700,
          fontFamily: typography.fontFamilyMono
        }}
      >
        {formatAccuracyPercent(accuracy)}
      </div>
      <div style={{ fontSize: typography.scale.xs, color: colors.textMuted, marginTop: spacing[1] }}>
        {correct} correct of {resolved} resolved · {rowsExamined} examined
      </div>
      {smallSample ? <SmallSamplePill colors={colors} /> : null}
    </div>
  );
}

interface DeltaColumnProps {
  delta: BucketDelta;
  colors: ReturnType<typeof useTheme>["colors"];
}

function DeltaColumn({ delta, colors }: DeltaColumnProps) {
  return (
    <div>
      <div
        style={{
          fontSize: typography.scale.xs,
          color: colors.textMuted,
          marginBottom: spacing[1]
        }}
      >
        Δ (B − A)
      </div>
      <div
        data-testid="hv-compare-overall-delta"
        style={{
          fontSize: typography.scale["2xl"],
          color: colors.text,
          fontWeight: 700,
          fontFamily: typography.fontFamilyMono
        }}
      >
        {formatAccuracyDelta(delta.accuracyDelta)}
      </div>
      <div style={{ fontSize: typography.scale.xs, color: colors.textMuted, marginTop: spacing[1] }}>
        {delta.resolvedDelta >= 0 ? "+" : ""}
        {delta.resolvedDelta} resolved · {delta.totalDelta >= 0 ? "+" : ""}
        {delta.totalDelta} total
      </div>
    </div>
  );
}

interface CompareStratificationCardProps {
  config: StratificationConfig;
  summaryA: HistoricalValidationSummary;
  summaryB: HistoricalValidationSummary;
  colors: ReturnType<typeof useTheme>["colors"];
}

function CompareStratificationCard({
  config,
  summaryA,
  summaryB,
  colors
}: CompareStratificationCardProps) {
  const mapA = summaryA[config.key];
  const mapB = summaryB[config.key];
  const keys = unionedOrderedKeys(mapA, mapB, config.preferredOrder);
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
      {keys.length === 0 ? (
        <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
          No signals in this stratum on either side.
        </p>
      ) : (
        keys.map((key) => (
          <CompareBucketRow
            key={key}
            label={labelFor(key)}
            a={mapA[key] ?? null}
            b={mapB[key] ?? null}
            colors={colors}
          />
        ))
      )}
    </section>
  );
}

function unionedOrderedKeys(
  mapA: Record<string, BucketStats>,
  mapB: Record<string, BucketStats>,
  preferred: string[] | undefined
): string[] {
  const all = new Set<string>([...Object.keys(mapA), ...Object.keys(mapB)]);
  const list = Array.from(all);
  if (!preferred || preferred.length === 0) {
    return list.sort((a, b) => a.localeCompare(b));
  }
  const rank = new Map(preferred.map((k, i) => [k, i] as const));
  return list.sort((a, b) => {
    const ra = rank.get(a) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

interface CompareBucketRowProps {
  label: string;
  a: BucketStats | null;
  b: BucketStats | null;
  colors: ReturnType<typeof useTheme>["colors"];
}

function CompareBucketRow({ label, a, b, colors }: CompareBucketRowProps) {
  const delta = diffBucketStats(a, b);
  const resolvedA = a ? a.correct + a.incorrect : 0;
  const resolvedB = b ? b.correct + b.incorrect : 0;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
        alignItems: "baseline",
        gap: spacing[2],
        padding: `${spacing[2]} 0`,
        borderBottom: `1px solid ${colors.surfaceMuted}`
      }}
      data-testid="hv-compare-bucket-row"
    >
      <span
        style={{
          fontSize: typography.scale.sm,
          color: colors.text,
          fontWeight: 600,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
        title={label}
      >
        {label}
      </span>
      <CompareCell
        accuracy={a?.accuracy ?? null}
        resolved={resolvedA}
        correct={a?.correct ?? 0}
        smallSample={delta.smallSampleA}
        colors={colors}
      />
      <CompareCell
        accuracy={b?.accuracy ?? null}
        resolved={resolvedB}
        correct={b?.correct ?? 0}
        smallSample={delta.smallSampleB}
        colors={colors}
      />
      <span
        data-testid="hv-compare-row-delta"
        style={{
          fontSize: typography.scale.sm,
          color: colors.text,
          fontFamily: typography.fontFamilyMono,
          fontWeight: 600,
          textAlign: "right"
        }}
      >
        {formatAccuracyDelta(delta.accuracyDelta)}
      </span>
    </div>
  );
}

interface CompareCellProps {
  accuracy: number | null;
  resolved: number;
  correct: number;
  smallSample: boolean;
  colors: ReturnType<typeof useTheme>["colors"];
}

function CompareCell({ accuracy, resolved, correct, smallSample, colors }: CompareCellProps) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: spacing[1] }}>
      <span
        style={{
          fontSize: typography.scale.sm,
          color: colors.text,
          fontFamily: typography.fontFamilyMono,
          fontWeight: 600
        }}
      >
        {formatAccuracyPercent(accuracy)}
      </span>
      <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
        ({correct}/{resolved})
      </span>
      {smallSample ? <SmallSamplePill colors={colors} /> : null}
    </span>
  );
}

function SmallSamplePill({ colors }: { colors: ReturnType<typeof useTheme>["colors"] }) {
  // A calm muted pill — never red/green. The label intentionally repeats the threshold
  // so the user does not have to read a separate doc to understand what "small sample"
  // means in this surface.
  return (
    <span
      data-testid="hv-compare-small-sample"
      title={`Fewer than ${SMALL_SAMPLE_THRESHOLD} resolved signals — treat the number as directional, not statistical.`}
      style={{
        display: "inline-block",
        padding: `0 ${spacing[1]}`,
        marginLeft: spacing[1],
        fontSize: typography.scale.xs,
        color: colors.textMuted,
        background: colors.surfaceMuted,
        borderRadius: borderRadius.sm,
        lineHeight: 1.6
      }}
    >
      small sample
    </span>
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
