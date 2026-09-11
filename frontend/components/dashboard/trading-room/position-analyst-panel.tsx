"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { TickerAnalystPanel } from "@/lib/api/ticker-news-panel";
import type { useTheme } from "@/lib/theme-provider";

type Colors = ReturnType<typeof useTheme>["colors"];

type Props = {
  panel: TickerAnalystPanel;
  colors: Colors;
};

function actionTone(action: string): "bullish" | "bearish" | "neutral" {
  const a = action.toLowerCase();
  if (a.includes("downgrade") || a.includes("underperform") || a.includes("sell")) return "bearish";
  if (a.includes("upgrade") || a.includes("outperform") || a.includes("buy") || a.includes("initiat")) {
    return "bullish";
  }
  return "neutral";
}

/**
 * POS-AI-13 (display-only) — analyst ratings/consensus panel for the Long Term deep-dive.
 * Renders only when the backend ships the ship-dark `position_analyst` payload (flag OFF by
 * default). This is DISPLAY-only: analyst data never feeds the composite score.
 */
export function PositionAnalystPanel({ panel, colors }: Props) {
  const consensus = panel.consensus;
  const hasContent = panel.ratings.length > 0 || Boolean(consensus?.label);

  return (
    <article
      data-testid="position-analyst-panel"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.lg,
        padding: spacing[4],
        display: "flex",
        flexDirection: "column",
        gap: spacing[3]
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "1.4px",
          textTransform: "uppercase",
          color: colors.textMuted
        }}
      >
        Analyst actions · {panel.window_days}d
      </p>

      {panel.feed_state === "unconfigured" ? (
        <p
          data-testid="position-analyst-unconfigured"
          style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}
        >
          Analyst ratings feed is not configured.
        </p>
      ) : null}

      {panel.feed_state === "empty" ? (
        <p
          data-testid="position-analyst-empty"
          style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}
        >
          No analyst rating changes in the last {panel.window_days} days.
        </p>
      ) : null}

      {panel.feed_state === "available" && hasContent ? (
        <>
          {consensus?.label ? (
            <div
              data-testid="position-analyst-consensus"
              style={{
                fontSize: typography.scale.sm,
                fontWeight: 700,
                color: (consensus.momentum ?? 0) < 0 ? colors.bearish : colors.bullish
              }}
            >
              {consensus.label}
              {consensus.upgrades_30d || consensus.downgrades_30d
                ? ` (${consensus.upgrades_30d} firms↑ ${consensus.downgrades_30d}↓)`
                : ""}
            </div>
          ) : null}

          {panel.ratings.length > 0 ? (
            <ul style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: spacing[2] }}>
              {panel.ratings.slice(0, 6).map((row) => {
                const tone = actionTone(row.action);
                const toneColor =
                  tone === "bullish" ? colors.bullish : tone === "bearish" ? colors.bearish : colors.caution;
                const ptBits: string[] = [];
                if (typeof row.price_target === "number" && Number.isFinite(row.price_target)) {
                  ptBits.push(`PT $${row.price_target.toFixed(2)}`);
                }
                if (typeof row.upside_pct === "number" && Number.isFinite(row.upside_pct)) {
                  ptBits.push(`${row.upside_pct >= 0 ? "+" : ""}${row.upside_pct.toFixed(1)}%`);
                }
                return (
                  <li
                    key={row.id}
                    data-testid="position-analyst-rating-row"
                    style={{
                      listStyle: "none",
                      border: `1px solid ${colors.border}`,
                      borderRadius: borderRadius.md,
                      padding: spacing[2],
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "baseline",
                      gap: spacing[2]
                    }}
                  >
                    <span style={{ fontSize: typography.scale.sm, fontWeight: 600, color: colors.text }}>
                      {row.firm}
                    </span>
                    <span style={{ fontSize: typography.scale.xs, fontWeight: 600, color: toneColor }}>
                      {row.action}
                      {row.rating ? ` · ${row.rating}` : ""}
                    </span>
                    {ptBits.length ? (
                      <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
                        {ptBits.join(" · ")}
                      </span>
                    ) : null}
                    {row.age_label ? (
                      <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, marginLeft: "auto" }}>
                        {row.age_label}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      ) : null}

      <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45, fontStyle: "italic" }}>
        Source: Benzinga analyst calendar. Informational — analyst views are not part of the signal score.
      </p>
    </article>
  );
}
