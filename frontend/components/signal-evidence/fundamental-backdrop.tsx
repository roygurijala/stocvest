"use client";

import type { CSSProperties } from "react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import type { SignalEvidenceFundamentalContext } from "@/lib/signal-evidence";
import { UpgradePrompt } from "@/components/upgrade-prompt";

type FundamentalBackdropProps = {
  context: SignalEvidenceFundamentalContext | null | undefined;
  isPaid: boolean;
  mode: "day" | "swing" | undefined;
};

const BACKDROP_STYLES: Record<
  SignalEvidenceFundamentalContext["backdrop"],
  { border: string; background: string; color: string; icon: string }
> = {
  positive: {
    border: "1px solid rgba(34,197,94,0.45)",
    background: "rgba(34,197,94,0.1)",
    color: "#16a34a",
    icon: "↑"
  },
  neutral: {
    border: "1px solid rgba(148,163,184,0.35)",
    background: "rgba(148,163,184,0.08)",
    color: "inherit",
    icon: "→"
  },
  mixed: {
    border: "1px solid rgba(245,158,11,0.45)",
    background: "rgba(245,158,11,0.1)",
    color: "#d97706",
    icon: "~"
  },
  weak: {
    border: "1px solid rgba(239,68,68,0.45)",
    background: "rgba(239,68,68,0.1)",
    color: "#dc2626",
    icon: "↓"
  }
};

function tagLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function MetricTile({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const box: CSSProperties = {
    border: `1px solid ${colors.border}`,
    borderRadius: borderRadius.md,
    padding: spacing[2],
    minWidth: 0,
    flex: "1 1 120px"
  };
  return (
    <div style={box}>
      <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, textTransform: "uppercase" }}>
        {label}
      </p>
      <p style={{ margin: `${spacing[1]} 0 0 0`, fontWeight: 600, fontSize: typography.scale.sm }}>{value}</p>
    </div>
  );
}

export function FundamentalBackdropPanel({ context, isPaid, mode }: FundamentalBackdropProps) {
  const { colors } = useTheme();

  if (mode === "day") {
    return null;
  }

  const shell: CSSProperties = {
    border: `1px solid ${colors.border}`,
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    display: "grid",
    gap: spacing[2]
  };

  if (!isPaid) {
    return (
      <section data-testid="fundamental-backdrop-upgrade" style={shell}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: spacing[2] }}>
          <h3 style={{ margin: 0, fontSize: typography.scale.sm, letterSpacing: "0.06em" }}>FUNDAMENTAL CONTEXT</h3>
          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>(not scored)</span>
        </div>
        <UpgradePrompt
          feature="Fundamental backdrop"
          plan="Swing Pro"
          description="Upgrade to see earnings trend, guidance direction, and analyst consensus as context alongside your swing read."
        />
      </section>
    );
  }

  if (!context) {
    return (
      <section data-testid="fundamental-backdrop-unavailable" style={shell}>
        <h3 style={{ margin: 0, fontSize: typography.scale.sm }}>Fundamental context (not scored)</h3>
        <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm }}>
          Fundamental data not available for this symbol right now.
        </p>
      </section>
    );
  }

  const tone = BACKDROP_STYLES[context.backdrop];
  const totalQ = Math.max(1, context.quarters_beating + context.quarters_missing);
  const earningsDetail =
    context.earnings_trend === "beating"
      ? `Beating ${context.quarters_beating}/${totalQ}`
      : context.earnings_trend === "missing"
        ? `Missing ${context.quarters_missing}/${totalQ}`
        : tagLabel(context.earnings_trend);

  return (
    <section data-testid="fundamental-backdrop-panel" style={shell}>
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: spacing[2] }}
      >
        <h3 style={{ margin: 0, fontSize: typography.scale.sm, letterSpacing: "0.06em" }}>FUNDAMENTAL CONTEXT</h3>
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>(not scored)</span>
      </div>

      <div
        style={{
          borderRadius: borderRadius.md,
          padding: spacing[2],
          border: tone.border,
          background: tone.background
        }}
      >
        <p style={{ margin: 0, fontWeight: 700, color: tone.color }}>
          {tone.icon} {tagLabel(context.backdrop)} backdrop
        </p>
        <p style={{ margin: `${spacing[1]} 0 0 0`, fontSize: typography.scale.sm }}>{context.summary_line}</p>
        {context.sector_display_name ? (
          <p style={{ margin: `${spacing[1]} 0 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
            Sector: {context.sector_display_name}
            {context.sector_etf ? ` (${context.sector_etf})` : ""}
          </p>
        ) : null}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>
        <MetricTile label="Earnings" value={earningsDetail} />
        <MetricTile label="Guidance" value={tagLabel(context.guidance_direction)} />
        <MetricTile
          label="Analysts"
          value={
            context.analyst_direction === "upgrading" || context.analyst_direction === "downgrading"
              ? `${context.recent_upgrades}↑ / ${context.recent_downgrades}↓`
              : tagLabel(context.analyst_direction)
          }
        />
      </div>

      <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, fontStyle: "italic" }}>
        Signal data only — not investment advice. Does not affect layer scores or alignment.
      </p>
    </section>
  );
}
