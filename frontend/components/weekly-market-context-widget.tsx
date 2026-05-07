"use client";

import type { MarketStatusPayload } from "@/lib/api/market";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { DecisionMetric } from "@/components/decision-metric";
import { getChangeColor } from "@/components/market-sentiment-score-widget";

export type WeeklyIndexRow = {
  symbol: string;
  label: string;
  pct5d: number | null;
  lastPrice: number | null;
};

type Props = {
  rows: WeeklyIndexRow[];
  marketStatus?: MarketStatusPayload;
  /** When snapshots/bars failed (e.g. API unreachable), surface this instead of an endless loading hint. */
  dataIssue?: string | null;
};

/** Weekly headline is context only — softer chroma so it does not read like a trade signal. */
function weekToneColor(accent: string, colors: ThemeColors): string {
  return `color-mix(in srgb, ${accent} 52%, ${colors.textMuted})`;
}

function weekTone(
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
    return { label: "Weekly data loading…", color: colors.textMuted };
  }
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (avg >= 0.6) {
    return {
      label: "Constructive 5-session tape (background)",
      color: weekToneColor(colors.bullish, colors)
    };
  }
  if (avg <= -0.6) {
    return {
      label: "Defensive 5-session tape (background)",
      color: weekToneColor(colors.bearish, colors)
    };
  }
  return {
    label: "Mixed 5-session tape (background)",
    color: `color-mix(in srgb, ${colors.caution} 58%, ${colors.textMuted})`
  };
}

export function WeeklyMarketContextWidget({ rows, marketStatus, dataIssue }: Props) {
  const { colors } = useTheme();
  const tone = weekTone(rows, colors, dataIssue);
  const mkt = (marketStatus?.market || "").toLowerCase();

  return (
    <div className={`flex flex-col gap-4 ${surfaceGlowClassName}`} style={{ color: colors.text }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p style={{ margin: 0, fontSize: typography.scale.sm, fontWeight: 600, color: tone.color }}>{tone.label}</p>
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
                  explanation="Change from the daily close roughly five sessions ago to the latest daily close for this index. Uses calendar trading days returned by Polygon; aligns with swing horizon rather than intraday tape."
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
                  explanation="Last regular-session print from the snapshot feed; weekly % uses daily closes, not this tick."
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
    </div>
  );
}
