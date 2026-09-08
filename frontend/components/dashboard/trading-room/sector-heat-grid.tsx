"use client";

import type { CSSProperties } from "react";
import { borderRadius, spacing, typography, type ThemeColors } from "@/lib/design-system";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import {
  formatHeatMissingQuote,
  formatSectorHeatPct,
  sectorHeatCellStyle,
  sectorHeatPrimaryPct,
  SECTOR_HEAT_MAX_HOLDINGS,
  type SectorHeatInput
} from "@/lib/dashboard/trading-room/sector-heat-present";
import {
  formatHeatVsGroup,
  heatCellPctForColor,
  heatGroupMedian,
  HEAT_RELATIVE_SIZE_MIN,
  heatRelativeTileLayout,
  heatRelativeSizeWeights,
  heatRelativeGridStyle,
  heatVsGroupDelta
} from "@/lib/dashboard/trading-room/heat-group-present";
import { HeatRelativeTileGrid } from "@/components/dashboard/trading-room/heat-relative-tile-grid";
import { tradingRoomMotionTransition } from "@/lib/dashboard/trading-room/trading-room-chrome";
import type { FeedLane } from "@/lib/dashboard/trading-room/feed-model";
import type { SectorRepresentativeRow } from "@/lib/dashboard/trading-room/market-brief-navigation";
import { MarketBriefSymbolLink } from "@/components/dashboard/trading-room/market-brief-symbol-link";

type SectorHeatGridProps = {
  sectors: SectorHeatInput[];
  sectorWindowLabel: string;
  selectedSymbol: string | null;
  interactive: boolean;
  colors: ThemeColors;
  onSelectSector: (symbol: string) => void;
};

export function SectorHeatGrid({
  sectors,
  sectorWindowLabel,
  selectedSymbol,
  interactive,
  colors,
  onSelectSector
}: SectorHeatGridProps) {
  if (sectors.length === 0) return null;

  const sectorPcts = sectors.map((sector) => sectorHeatPrimaryPct(sector, sectorWindowLabel));
  const groupMedian = heatGroupMedian(sectorPcts);
  const weights = heatRelativeSizeWeights(sectorPcts, groupMedian);

  const gridStyle: CSSProperties = {
    ...heatRelativeGridStyle,
    gap: spacing[2]
  };

  return (
    <div data-testid="market-brief-sector-heat-grid" style={gridStyle}>
      {sectors.map((sector, index) => {
        const pct = sectorPcts[index]!;
        const layout = heatRelativeTileLayout(weights[index] ?? HEAT_RELATIVE_SIZE_MIN);
        const selected = selectedSymbol === sector.symbol;
        const tone = pct >= 0 ? colors.bullish : colors.bearish;
        const cellStyle: CSSProperties = {
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          gap: 2,
          flex: layout.flex,
          minHeight: layout.minHeight,
          maxWidth: "100%",
          boxSizing: "border-box",
          padding: `${spacing[2]} ${spacing[2]}`,
          borderRadius: borderRadius.md,
          border: "none",
          textAlign: "left",
          cursor: interactive ? "pointer" : undefined,
          transition: tradingRoomMotionTransition("background", "box-shadow", "min-height", "flex"),
          ...sectorHeatCellStyle(pct, colors, { selected })
        };

        const body = (
          <>
            <span
              style={{
                fontSize: typography.scale.xs,
                fontWeight: 600,
                color: colors.textMuted,
                lineHeight: 1.2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "100%"
              }}
            >
              {sector.label}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                fontFamily: typography.fontFamilyMono,
                color: colors.textMuted,
                letterSpacing: "0.04em"
              }}
            >
              {sector.symbol}
            </span>
            <span style={{ fontSize: typography.scale.sm, fontWeight: 700, color: tone }}>{formatSectorHeatPct(pct)}</span>
          </>
        );

        if (!interactive) {
          return (
            <span
              key={sector.symbol}
              data-testid={`market-brief-sector-heat-${sector.symbol}`}
              style={cellStyle}
            >
              {body}
            </span>
          );
        }

        return (
          <button
            key={sector.symbol}
            type="button"
            data-testid={`market-brief-sector-heat-${sector.symbol}`}
            aria-pressed={selected}
            {...interactionLevelProps("medium")}
            onClick={() => onSelectSector(sector.symbol)}
            style={{ ...cellStyle, color: "inherit" }}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}

type SectorHoldingsHeatGridProps = {
  rows: SectorRepresentativeRow[];
  colors: ThemeColors;
  quotesLoading: boolean;
  laneForSymbol: (symbol: string) => FeedLane;
  onSelectSymbol: (symbol: string, company?: string | null, lane?: FeedLane) => void;
};

export function SectorHoldingsHeatGrid({
  rows,
  colors,
  quotesLoading,
  laneForSymbol,
  onSelectSymbol
}: SectorHoldingsHeatGridProps) {
  const capped = rows.slice(0, SECTOR_HEAT_MAX_HOLDINGS);
  if (capped.length === 0) return null;

  const groupMedian = heatGroupMedian(capped.map((row) => row.changePct));
  const pcts = capped.map((row) => row.changePct);

  return (
    <HeatRelativeTileGrid pcts={pcts} testId="market-brief-sector-holdings-heat">
      {({ index, layout }) => {
        const row = capped[index]!;
        const pct = row.changePct;
        const vsGroup = heatVsGroupDelta(pct, groupMedian);
        const colorPct = heatCellPctForColor(pct, vsGroup);
        const moveTone =
          pct == null ? colors.textMuted : pct >= 0 ? colors.bullish : colors.bearish;
        const bg =
          colorPct == null
            ? colors.surface
            : sectorHeatCellStyle(colorPct, colors).background ?? colors.surface;
        const vsLabel = formatHeatVsGroup(vsGroup);
        const missingQuote = pct == null && !quotesLoading;

        return (
          <MarketBriefSymbolLink
            key={row.symbol}
            symbol={row.symbol}
            company={row.company}
            lane={laneForSymbol(row.symbol)}
            onSelect={onSelectSymbol}
            data-testid={`market-brief-sector-holding-heat-${row.symbol}`}
            title={
              missingQuote
                ? "No live quote for this holding"
                : vsLabel
                  ? `${formatSectorHeatPct(pct)} (${vsLabel}). Larger tiles moved further vs sector peers.`
                  : "Larger tiles moved further vs sector peers."
            }
            {...interactionLevelProps("deep")}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              justifyContent: "center",
              gap: 2,
              flex: layout.flex,
              minHeight: layout.minHeight,
              maxWidth: "100%",
              boxSizing: "border-box",
              padding: `${spacing[1]} ${spacing[2]}`,
              borderRadius: borderRadius.sm,
              border: "none",
              background: bg,
              boxShadow: `inset 0 0 0 1px ${colors.border}55`,
              transition: tradingRoomMotionTransition("background", "box-shadow", "min-height", "flex")
            }}
          >
            <span style={{ fontWeight: 700, fontFamily: typography.fontFamilyMono, fontSize: typography.scale.xs }}>
              {row.symbol}
            </span>
            <span style={{ fontSize: typography.scale.sm, fontWeight: 700, color: moveTone }}>
              {quotesLoading && pct == null ? "…" : missingQuote ? formatHeatMissingQuote() : formatSectorHeatPct(pct)}
            </span>
            {vsLabel && pct != null ? (
              <span style={{ fontSize: 9, fontWeight: 600, color: colors.textMuted }}>{vsLabel}</span>
            ) : null}
          </MarketBriefSymbolLink>
        );
      }}
    </HeatRelativeTileGrid>
  );
}
