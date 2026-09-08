"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import {
  pillarVerdictTone,
  type PositionFundamentalsSummary,
  type PositionPillarRow
} from "@/lib/dashboard/trading-room/position-fundamentals-present";
import type { useTheme } from "@/lib/theme-provider";

type Colors = ReturnType<typeof useTheme>["colors"];

function verdictColor(tone: ReturnType<typeof pillarVerdictTone>, colors: Colors): string {
  if (tone === "bullish") return colors.bullish;
  if (tone === "bearish") return colors.bearish;
  if (tone === "neutral") return colors.caution;
  return colors.textMuted;
}

function PillarCard({ pillar, colors, highlight }: { pillar: PositionPillarRow; colors: Colors; highlight: boolean }) {
  const tone = pillarVerdictTone(pillar.verdict);
  const toneColor = verdictColor(tone, colors);
  const scoreLabel = pillar.score != null ? `${pillar.score}/100` : "—";

  return (
    <article
      data-testid={`position-pillar-${pillar.pillarId}`}
      style={{
        background: colors.surface,
        border: `1px solid ${highlight ? toneColor : colors.border}`,
        borderRadius: borderRadius.md,
        padding: spacing[3],
        boxShadow: highlight ? `0 0 0 1px ${toneColor}40` : undefined
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: spacing[2], alignItems: "flex-start" }}>
        <div>
          <p
            style={{
              margin: 0,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "1.2px",
              textTransform: "uppercase",
              color: colors.textMuted
            }}
          >
            {pillar.pillarId}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: typography.scale.sm, fontWeight: 600, color: colors.text }}>
            {pillar.label}
          </p>
        </div>
        <span style={{ fontSize: typography.scale.sm, fontWeight: 700, color: toneColor, fontVariantNumeric: "tabular-nums" }}>
          {scoreLabel}
        </span>
      </div>
      {pillar.reasoning ? (
        <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>
          {pillar.reasoning}
        </p>
      ) : null}
      {pillar.chips.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: spacing[2] }}>
          {pillar.chips.slice(0, 4).map((chip) => (
            <span
              key={chip}
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: borderRadius.full,
                background: colors.surfaceMuted,
                color: colors.textMuted,
                border: `1px solid ${colors.border}`
              }}
            >
              {chip}
            </span>
          ))}
        </div>
      ) : null}
      {pillar.status === "unavailable" || pillar.dataQuality === "degraded" ? (
        <p style={{ margin: `${spacing[2]} 0 0`, fontSize: 10, color: colors.caution, fontWeight: 600 }}>
          {pillar.status === "unavailable" ? "Data unavailable" : "Degraded data"}
        </p>
      ) : null}
    </article>
  );
}

type Props = {
  summary: PositionFundamentalsSummary;
  colors: Colors;
};

export function PositionFundamentalsGrid({ summary, colors }: Props) {
  if (summary.pillars.length === 0) {
    return (
      <p data-testid="position-fundamentals-empty" style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
        Fundamentals pillars not available for this symbol yet.
      </p>
    );
  }

  return (
    <div data-testid="position-fundamentals-grid" style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: spacing[3]
        }}
      >
        {summary.pillars.map((pillar) => (
          <PillarCard
            key={pillar.pillarId}
            pillar={pillar}
            colors={colors}
            highlight={summary.weakestPillarId === pillar.pillarId}
          />
        ))}
      </div>
    </div>
  );
}
