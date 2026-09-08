"use client";

import type { CSSProperties } from "react";
import { borderRadius, spacing, typography, type ThemeColors } from "@/lib/design-system";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import {
  formatHeatMissingQuote,
  formatSectorHeatPct,
  sectorHeatCellStyle
} from "@/lib/dashboard/trading-room/sector-heat-present";
import {
  formatHeatVsGroup,
  heatCellPctForColor,
  heatGroupMedian,
  heatVsGroupDelta
} from "@/lib/dashboard/trading-room/heat-group-present";
import { HeatRelativeTileGrid } from "@/components/dashboard/trading-room/heat-relative-tile-grid";
import { tradingRoomMotionTransition } from "@/lib/dashboard/trading-room/trading-room-chrome";
import type { FeedCard } from "@/lib/dashboard/trading-room/feed-model";
import {
  watchlistHeatShowsStateBadge,
  watchlistHeatStateBadgeLabel,
  type WatchlistHeatWindow
} from "@/lib/dashboard/trading-room/watchlist-rail-present";

type WatchlistHeatGridProps = {
  cards: FeedCard[];
  selectedId: string | null;
  colors: ThemeColors;
  onSelectCard: (card: FeedCard) => void;
  quotesLoading?: boolean;
  heatWindow?: WatchlistHeatWindow;
};

export function WatchlistHeatGrid({
  cards,
  selectedId,
  colors,
  onSelectCard,
  quotesLoading = false,
  heatWindow = "1d"
}: WatchlistHeatGridProps) {
  if (cards.length === 0) return null;

  const groupMedian = heatGroupMedian(cards.map((c) => c.changePct));
  const pcts = cards.map((c) => c.changePct);

  return (
    <HeatRelativeTileGrid pcts={pcts} testId="trading-room-watchlist-heat-grid">
      {({ index, layout }) => {
        const card = cards[index]!;
        const pct = card.changePct;
        const vsGroup = heatVsGroupDelta(pct, groupMedian);
        const colorPct = heatCellPctForColor(pct, vsGroup);
        const moveTone =
          pct == null ? colors.textMuted : pct >= 0 ? colors.bullish : colors.bearish;
        const selected = card.id === selectedId;
        const badge = watchlistHeatStateBadgeLabel(card.state);
        const bg =
          colorPct == null
            ? colors.surface
            : sectorHeatCellStyle(colorPct, colors, { selected }).background ?? colors.surface;
        const vsLabel = formatHeatVsGroup(vsGroup);
        const missingQuote = pct == null && !quotesLoading;

        const tileStyle: CSSProperties = {
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          gap: 2,
          flex: layout.flex,
          height: layout.height,
          minHeight: layout.height,
          maxWidth: "100%",
          boxSizing: "border-box",
          padding: `${spacing[1]} ${spacing[2]}`,
          borderRadius: borderRadius.sm,
          border: "none",
          background: bg,
          boxShadow: selected
            ? `inset 0 0 0 2px ${colors.accent}`
            : `inset 0 0 0 1px ${colors.border}55`,
          cursor: "pointer",
          textAlign: "left",
          color: colors.text,
          transition: tradingRoomMotionTransition("background", "box-shadow", "height", "flex")
        };

        return (
          <button
            key={card.id}
            type="button"
            data-testid={`trading-room-watchlist-heat-${card.symbol}`}
            title={
              missingQuote
                ? "No live quote — symbol may be halted, illiquid, or delisted"
                : vsLabel
                  ? `${formatSectorHeatPct(pct)} (${vsLabel}, ${heatWindow.toUpperCase()} window). Larger tiles moved further vs the watchlist median.`
                  : "Larger tiles moved further vs the watchlist median."
            }
            {...interactionLevelProps("deep")}
            onClick={() => onSelectCard(card)}
            style={tileStyle}
          >
            <span style={{ fontWeight: 700, fontFamily: typography.fontFamilyMono, fontSize: typography.scale.xs }}>
              {card.symbol}
            </span>
            <span style={{ fontSize: typography.scale.sm, fontWeight: 700, color: moveTone }}>
              {quotesLoading && pct == null ? "…" : missingQuote ? formatHeatMissingQuote() : formatSectorHeatPct(pct)}
            </span>
            {vsLabel && pct != null ? (
              <span style={{ fontSize: 9, fontWeight: 600, color: colors.textMuted }}>{vsLabel}</span>
            ) : null}
            {watchlistHeatShowsStateBadge(card.state) && badge ? (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: card.state === "actionable" ? colors.bullish : colors.caution
                }}
              >
                {badge}
              </span>
            ) : null}
          </button>
        );
      }}
    </HeatRelativeTileGrid>
  );
}
