"use client";

import { typography } from "@/lib/design-system";
import type { WatchlistMaturationRailKey } from "@/lib/watchlist-maturation-rails";
import { WATCHLIST_MATURATION_RAIL_LABELS } from "@/lib/watchlist-maturation-rails";
import type { WatchlistPortfolioSummary } from "@/lib/watchlist-row-present";
import { useTheme } from "@/lib/theme-provider";

const RAILS: Array<
  | { key: WatchlistMaturationRailKey; colorKey: "bullish" | "muted" }
  | { key: WatchlistMaturationRailKey; color: string }
> = [
  { key: "actionable", colorKey: "bullish" },
  { key: "developing", color: "#f59e0b" },
  { key: "notAligned", colorKey: "muted" },
  { key: "invalidated", colorKey: "muted" }
];

type Props = {
  counts: WatchlistPortfolioSummary;
  activeRail?: WatchlistMaturationRailKey | null;
  onRailClick?: (rail: WatchlistMaturationRailKey) => void;
};

export function WatchlistStatusRails({ counts, activeRail = null, onRailClick }: Props) {
  const { colors } = useTheme();

  return (
    <div
      data-testid="watchlist-status-rails"
      style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
      aria-label="Watchlist maturation summary"
    >
      {RAILS.map((rail) => {
        const n = counts[rail.key];
        const disabled = n === 0 || !onRailClick;
        const active = activeRail === rail.key;
        const borderColor =
          "color" in rail
            ? rail.color
            : rail.colorKey === "bullish"
              ? colors.bullish
              : colors.textMuted;
        const label = WATCHLIST_MATURATION_RAIL_LABELS[rail.key];
        return (
          <button
            key={rail.key}
            type="button"
            data-testid={`watchlist-status-rail-${rail.key}`}
            aria-pressed={active}
            aria-label={`${label}: ${n}${disabled ? "" : active ? ", filter active, click to clear" : ", click to filter"}`}
            disabled={disabled}
            onClick={() => onRailClick?.(rail.key)}
            style={{
              minWidth: 52,
              paddingTop: 5,
              paddingBottom: 2,
              paddingLeft: 4,
              paddingRight: 4,
              borderTop: `3px solid ${borderColor}`,
              borderRight: "none",
              borderBottom: "none",
              borderLeft: "none",
              background: active ? "rgba(0,180,255,0.1)" : "transparent",
              borderRadius: 4,
              textAlign: "center",
              cursor: disabled ? "default" : "pointer",
              opacity: disabled ? 0.45 : 1
            }}
          >
            <span
              style={{
                display: "block",
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: active ? colors.accent : colors.textMuted
              }}
            >
              {label}
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
          </button>
        );
      })}
    </div>
  );
}
