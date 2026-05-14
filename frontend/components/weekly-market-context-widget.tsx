"use client";

import type { MarketStatusPayload } from "@/lib/api/market";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { DecisionMetric } from "@/components/decision-metric";
import { getChangeColor } from "@/components/market-sentiment-score-widget";

/**
 * Short-Horizon Market State (Last ~5 Sessions) — Mode Separation B28 Phase 2 copy redesign.
 *
 * This widget is SHARED CONTEXT: both the Swing Desk and the Day Desk read it. Its language
 * MUST be observational and timeframe-anchored, never evaluative or strategy-coded.
 *
 *  - ❌ Banned (evaluative / swing-coded): "Constructive 5-session tape", "trend intact",
 *    "continuation", "setup". Any word that implies actionability belongs on a desk surface,
 *    not on shared context.
 *  - ✅ Required (descriptive / observational): factual statements of what the last ~5 daily
 *    closes did — net upward / net downward / mixed direction; range-bound / expanding.
 *
 * The "background" suffix that used to soften the label is intentionally dropped — the role
 * pill ("SHARED CONTEXT") on the parent DashboardCard now carries that disambiguation.
 */
export type WeeklyIndexRow = {
  symbol: string;
  label: string;
  pct5d: number | null;
  lastPrice: number | null;
  /**
   * Last ~5 daily closes for this index, oldest → newest.
   *
   * Drives the per-session returns chart in the Shared Context master card (Phase 2b).
   * `null` / missing means the daily-bar feed was unavailable when the page
   * rendered — callers should fall back to rendering just the pct5d label.
   */
  closes5d?: number[];
  /**
   * Cash-session high/low from the snapshot feed plus last, for a compact
   * “where last sits in today’s range” readout. Omitted when H/L are missing.
   */
  sessionDayRange?: {
    low: number;
    high: number;
    last: number;
    open: number | null;
    prevClose: number | null;
  };
};

type Props = {
  rows: WeeklyIndexRow[];
  marketStatus?: MarketStatusPayload;
  /** When snapshots/bars failed (e.g. API unreachable), surface this instead of an endless loading hint. */
  dataIssue?: string | null;
};

/** Status-line headline is shared context only — softer chroma so it does not read like a trade signal. */
function statusLineToneColor(accent: string, colors: ThemeColors): string {
  return `color-mix(in srgb, ${accent} 52%, ${colors.textMuted})`;
}

/**
 * Translates the 5-session average into a STRICTLY DESCRIPTIVE status line.
 * The buckets are price-direction observations, not setup signals — vocabulary
 * is anchored to what the last ~5 daily closes did, never what a trader should do.
 *
 * Threshold parity with the legacy weekTone helper is preserved (±0.6%) so existing
 * tests that exercise the bucket boundaries still anchor correctly.
 */
function shortHorizonStatusLine(
  rows: WeeklyIndexRow[],
  colors: ThemeColors,
  dataIssue?: string | null
): { label: string; color: string } {
  const vals = rows.map((r) => r.pct5d).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (vals.length === 0) {
    const hint = typeof dataIssue === "string" ? dataIssue.trim() : "";
    if (hint) {
      return { label: hint.length > 140 ? `${hint.slice(0, 137)}…` : hint, color: colors.caution };
    }
    return { label: "Last 5 sessions — data loading…", color: colors.textMuted };
  }
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (avg >= 0.6) {
    // ✅ Observational: states what happened across the last ~5 daily closes.
    // ❌ Old wording "Constructive 5-session tape (background)" was evaluative and swing-coded.
    return {
      label: "5-Session Outcome: Net upward price progress",
      color: statusLineToneColor(colors.bullish, colors)
    };
  }
  if (avg <= -0.6) {
    return {
      label: "5-Session Outcome: Net downward price progress",
      color: statusLineToneColor(colors.bearish, colors)
    };
  }
  return {
    label: "5-Session Outcome: Mixed direction across indices",
    color: `color-mix(in srgb, ${colors.caution} 58%, ${colors.textMuted})`
  };
}

/**
 * Verbatim guardrail strings — exposed as named constants so tests can pin the exact
 * wording and so a future refactor cannot accidentally drop the timeframe-binding clause.
 * The "Timeframe / Purpose" pair is the single sentence that does the heavy lifting:
 * day traders see explicitly that this does NOT imply trade duration, and swing traders
 * still see their cadence reflected.
 */
export const SHORT_HORIZON_TIMEFRAME_LINE =
  "Timeframe: Calculated from daily closes over the last ~5 trading sessions. Purpose: Provides background bias only; does not imply trade duration.";

export const SHORT_HORIZON_WHY_THIS_MATTERS =
  "Why this matters: Multi-session price direction influences risk appetite, follow-through probability, and position sizing across all trading horizons.";

export function WeeklyMarketContextWidget({ rows, marketStatus, dataIssue }: Props) {
  const { colors } = useTheme();
  const statusLine = shortHorizonStatusLine(rows, colors, dataIssue);
  const mkt = (marketStatus?.market || "").toLowerCase();

  return (
    <div
      className={`flex flex-col gap-4 ${surfaceGlowClassName}`}
      style={{ color: colors.text, paddingTop: spacing[2] }}
      data-testid="short-horizon-market-state"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          data-testid="short-horizon-status-line"
          style={{ margin: 0, fontSize: typography.scale.sm, fontWeight: 600, color: statusLine.color, lineHeight: 1.4 }}
        >
          {statusLine.label}
        </p>
        {marketStatus ? (
          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
            Cash session:{" "}
            <strong style={{ color: mkt === "open" ? colors.bullish : colors.textMuted }}>
              {mkt === "open" ? "Open" : "Closed"}
            </strong>
          </span>
        ) : null}
      </div>
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))"
        }}
      >
        {rows.map((r) => (
          <div
            key={r.symbol}
            style={{
              borderRadius: borderRadius.md,
              border: `1px solid ${colors.border}`,
              background: "rgba(148,163,184,0.06)",
              padding: spacing[3]
            }}
          >
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: typography.scale.sm }}>{r.symbol}</p>
              <p style={{ margin: 0, fontSize: 10, color: colors.textMuted }}>{r.label}</p>
            </div>
            <div
              style={{
                margin: `${spacing[2]} 0 0`,
                fontSize: typography.scale.lg,
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
                color: r.pct5d != null ? getChangeColor(r.pct5d, colors) : colors.textMuted
              }}
            >
              {r.pct5d != null ? (
                <DecisionMetric
                  explanation="Change from the daily close roughly five sessions ago to the latest daily close for this index. Uses calendar trading days returned by Polygon — descriptive of recent price behavior across all desks, not a swing-only signal."
                  label="How 5-session % is computed"
                  maxWidth={300}
                >
                  <span>{`${r.pct5d >= 0 ? "+" : ""}${r.pct5d.toFixed(2)}%`}</span>
                </DecisionMetric>
              ) : (
                "—"
              )}
            </div>
            <div style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted, fontVariantNumeric: "tabular-nums" }}>
              Last{" "}
              {r.lastPrice != null ? (
                <DecisionMetric
                  explanation="Last regular-session print from the snapshot feed; 5-session % uses daily closes, not this tick."
                  label="Last price"
                  maxWidth={260}
                >
                  <span style={{ color: colors.text }}>${r.lastPrice.toFixed(2)}</span>
                </DecisionMetric>
              ) : (
                "—"
              )}
            </div>
          </div>
        ))}
      </div>
      {/*
       * Timeframe-binding clause + why-this-matters hint. Together these two lines do the
       * heavy lifting that prevents day traders from misreading this as swing-only and
       * prevents future questions about "what is this?" / "why does this exist on my page?".
       * They render under the index grid so they appear as definition/footnote material,
       * not as headline copy.
       */}
      <div
        data-testid="short-horizon-guardrails"
        style={{
          display: "grid",
          gap: spacing[1],
          marginTop: spacing[1],
          fontSize: typography.scale.xs,
          color: colors.textMuted,
          lineHeight: 1.5
        }}
      >
        <p style={{ margin: 0 }}>{SHORT_HORIZON_TIMEFRAME_LINE}</p>
        <p style={{ margin: 0 }}>{SHORT_HORIZON_WHY_THIS_MATTERS}</p>
      </div>
    </div>
  );
}
