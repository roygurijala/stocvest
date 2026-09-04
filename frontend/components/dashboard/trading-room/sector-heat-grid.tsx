"use client";

import type { CSSProperties } from "react";
import { borderRadius, spacing, typography, type ThemeColors } from "@/lib/design-system";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import {
  formatSectorHeatPct,
  sectorHeatCellStyle,
  sectorHeatGridColumns,
  sectorHeatPrimaryPct,
  SECTOR_HEAT_MAX_HOLDINGS,
  type SectorHeatInput
} from "@/lib/dashboard/trading-room/sector-heat-present";
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

  const gridStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: sectorHeatGridColumns(sectors.length),
    gap: spacing[2],
    width: "100%"
  };

  return (
    <div data-testid="market-brief-sector-heat-grid" style={gridStyle}>
      {sectors.map((sector) => {
        const pct = sectorHeatPrimaryPct(sector, sectorWindowLabel);
        const selected = selectedSymbol === sector.symbol;
        const tone = pct >= 0 ? colors.bullish : colors.bearish;
        const cellStyle: CSSProperties = {
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          gap: 2,
          minHeight: 56,
          padding: `${spacing[2]} ${spacing[2]}`,
          borderRadius: borderRadius.md,
          border: "none",
          textAlign: "left",
          cursor: interactive ? "pointer" : undefined,
          transition: tradingRoomMotionTransition("background", "box-shadow"),
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

  const gridStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: sectorHeatGridColumns(capped.length),
    gap: spacing[1],
    width: "100%"
  };

  return (
    <div data-testid="market-brief-sector-holdings-heat" style={gridStyle}>
      {capped.map((row) => {
        const pct = row.changePct;
        const moveTone =
          pct == null ? colors.textMuted : pct >= 0 ? colors.bullish : colors.bearish;
        const bg =
          pct == null
            ? colors.surface
            : sectorHeatCellStyle(pct, colors).background ?? colors.surface;

        return (
          <MarketBriefSymbolLink
            key={row.symbol}
            symbol={row.symbol}
            company={row.company}
            lane={laneForSymbol(row.symbol)}
            onSelect={onSelectSymbol}
            data-testid={`market-brief-sector-holding-heat-${row.symbol}`}
            {...interactionLevelProps("deep")}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 2,
              minHeight: 48,
              padding: `${spacing[1]} ${spacing[2]}`,
              borderRadius: borderRadius.sm,
              border: "none",
              background: bg,
              boxShadow: `inset 0 0 0 1px ${colors.border}55`,
              transition: tradingRoomMotionTransition("background", "box-shadow")
            }}
          >
            <span style={{ fontWeight: 700, fontFamily: typography.fontFamilyMono, fontSize: typography.scale.xs }}>
              {row.symbol}
            </span>
            <span style={{ fontSize: typography.scale.sm, fontWeight: 700, color: moveTone }}>
              {quotesLoading && pct == null ? "…" : formatSectorHeatPct(pct)}
            </span>
          </MarketBriefSymbolLink>
        );
      })}
    </div>
  );
}
