"use client";

import { typography } from "@/lib/design-system";
import type { WatchlistPortfolioSummary } from "@/lib/watchlist-row-present";
import { useTheme } from "@/lib/theme-provider";

const RAILS = [
  { key: "actionable", label: "Actionable", colorKey: "bullish" as const },
  { key: "developing", label: "Developing", color: "#f59e0b" },
  { key: "notAligned", label: "Not aligned", colorKey: "muted" as const },
  { key: "invalidated", label: "Invalidated", colorKey: "muted" as const }
] as const;

type Props = {
  counts: WatchlistPortfolioSummary;
};

export function WatchlistStatusRails({ counts }: Props) {
  const { colors } = useTheme();

  return (
    <div
      data-testid="watchlist-status-rails"
      style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
      aria-label="Watchlist maturation summary"
    >
      {RAILS.map((rail) => {
        const n = counts[rail.key];
        const borderColor =
          "color" in rail
            ? rail.color
            : rail.colorKey === "bullish"
              ? colors.bullish
              : colors.textMuted;
        return (
          <div
            key={rail.key}
            data-testid={`watchlist-status-rail-${rail.key}`}
            style={{
              minWidth: 52,
              paddingTop: 5,
              borderTop: `3px solid ${borderColor}`,
              textAlign: "center"
            }}
          >
            <span
              style={{
                display: "block",
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: colors.textMuted
              }}
            >
              {rail.label}
            </span>
            <span
              style={{
                display: "block",
                marginTop: 2,
                fontSize: typography.scale.lg,
                fontWeight: 700,
                color: colors.text,
                lineHeight: 1
              }}
            >
              {n}
            </span>
          </div>
        );
      })}
    </div>
  );
}
