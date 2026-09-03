"use client";

import { useMemo } from "react";
import type { IntradaySetupPayload } from "@/lib/api/scanner";
import type { DeskTodayData } from "@/lib/api/desk-today";
import {
  buildMarketSwingRankedRowsResult,
  marketSwingTableSourceDisclaimer,
  type PersonalRankedRow
} from "@/lib/dashboard/personal-ranked-home-present";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { useTheme } from "@/lib/theme-provider";
import type { FeedState } from "@/lib/dashboard/trading-room/feed-model";
import type { ScannerNearQualificationRow } from "@/lib/scanner-scan-summary";

const SWING_ACCENT = "#8B5CF6";

const GRID_COLS = "minmax(4.5rem, auto) minmax(6rem, 1.1fr) minmax(5rem, 0.9fr) minmax(3.5rem, auto) minmax(5.5rem, 1fr) minmax(0, 2fr)";

type ThemeColors = ReturnType<typeof useTheme>["colors"];

export function MarketSwingSetupsTable({
  swingDesk,
  swingSetups = [],
  nearQualification = [],
  onSelectSymbol,
  colors,
  isMobile = false,
  embedded = false
}: {
  swingDesk: DeskTodayData | null | undefined;
  swingSetups?: readonly IntradaySetupPayload[];
  nearQualification?: readonly ScannerNearQualificationRow[];
  onSelectSymbol: (symbol: string) => void;
  colors: ThemeColors;
  isMobile?: boolean;
  /** When true, omit outer title — parent section supplies the header. */
  embedded?: boolean;
}) {
  const { rows, source } = useMemo(
    () =>
      buildMarketSwingRankedRowsResult({
        swingDesk,
        swingSetups,
        nearQualification
      }),
    [swingDesk, swingSetups, nearQualification]
  );
  const sourceDisclaimer = marketSwingTableSourceDisclaimer(source);

  return (
    <div
      data-testid="market-swing-setups-table"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing[3],
        padding: embedded ? 0 : isMobile ? `${spacing[4]} 0` : `${spacing[5]} 0`,
        minHeight: 0
      }}
    >
      {!embedded ? (
        <header style={{ display: "grid", gap: spacing[1] }}>
          <h2
            style={{
              margin: 0,
              fontSize: typography.scale.lg,
              fontWeight: 600,
              letterSpacing: "-0.02em"
            }}
          >
            Swing setups from market scan
          </h2>
          <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted, maxWidth: "42rem" }}>
            Ranked from cached swing desk discovery — tap a row for the full deep dive.
          </p>
        </header>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState colors={colors} />
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: spacing[2]
          }}
        >
          {sourceDisclaimer ? (
            <p
              data-testid="market-swing-setups-fallback-note"
              style={{
                margin: 0,
                fontSize: typography.scale.xs,
                color: colors.textMuted,
                lineHeight: 1.45
              }}
            >
              {sourceDisclaimer}
            </p>
          ) : null}
          <div
            style={{
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.md,
              overflow: isMobile ? "auto" : "hidden",
              background: colors.surface
            }}
          >
          <div
            role="row"
            style={{
              display: "grid",
              gridTemplateColumns: GRID_COLS,
              gap: spacing[2],
              padding: `${spacing[2]} ${spacing[3]}`,
              borderBottom: `1px solid ${colors.border}`,
              background: colors.surfaceMuted,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: colors.textMuted,
              minWidth: isMobile ? "640px" : undefined
            }}
          >
            <span>Symbol</span>
            <span>Readiness</span>
            <span>Direction</span>
            <span>R/R</span>
            <span>State</span>
            <span>Why</span>
          </div>
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {rows.map((row, index) => (
              <RankedRow
                key={row.symbol}
                row={row}
                index={index}
                onSelect={() => onSelectSymbol(row.symbol)}
                colors={colors}
                isMobile={isMobile}
              />
            ))}
          </ol>
        </div>
        </div>
      )}
    </div>
  );
}

/** @deprecated Use MarketSwingSetupsTable */
export const PersonalRankedHomeTable = MarketSwingSetupsTable;

function EmptyState({ colors }: { colors: ThemeColors }) {
  return (
    <div
      data-testid="market-swing-setups-empty"
      style={{
        padding: spacing[4],
        borderRadius: borderRadius.md,
        border: `1px dashed ${colors.border}`,
        color: colors.textMuted,
        fontSize: typography.scale.sm,
        textAlign: "center"
      }}
    >
      No qualified swing setups in the current market scan. Check back after the next desk refresh.
    </div>
  );
}

function rowAccent(feedState: FeedState, colors: ThemeColors): string {
  if (feedState === "actionable") return SWING_ACCENT;
  if (feedState === "near") return colors.caution;
  if (feedState === "cooling") return colors.bearish;
  return colors.border;
}

function RankedRow({
  row,
  index,
  onSelect,
  colors,
  isMobile
}: {
  row: PersonalRankedRow;
  index: number;
  onSelect: () => void;
  colors: ThemeColors;
  isMobile: boolean;
}) {
  const biasColor =
    row.bias === "bull" ? colors.bullish : row.bias === "bear" ? colors.bearish : colors.textMuted;
  const tierAccent = rowAccent(row.feedState, colors);

  return (
    <li>
      <button
        type="button"
        data-testid={`market-swing-row-${row.symbol}`}
        onClick={onSelect}
        style={{
          display: "grid",
          gridTemplateColumns: GRID_COLS,
          gap: spacing[2],
          width: "100%",
          padding: `${spacing[2]} ${spacing[3]}`,
          border: "none",
          borderBottom: `1px solid ${colors.border}`,
          borderLeft: `3px solid ${tierAccent}`,
          background: index % 2 === 0 ? colors.surface : colors.surfaceMuted,
          color: colors.text,
          textAlign: "left",
          cursor: "pointer",
          fontSize: typography.scale.sm,
          minWidth: isMobile ? "640px" : undefined,
          transition: "background 0.12s ease"
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = colors.surfaceMuted;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = index % 2 === 0 ? colors.surface : colors.surfaceMuted;
        }}
      >
        <span style={{ fontWeight: 600, fontFamily: typography.fontFamilyMono }}>{row.symbol}</span>
        <span style={{ color: colors.textMuted }}>{row.readiness}</span>
        <span style={{ color: biasColor, fontWeight: 500 }}>{row.direction}</span>
        <span style={{ fontFamily: typography.fontFamilyMono, color: row.riskReward ? colors.text : colors.textMuted }}>
          {row.riskReward ?? "—"}
        </span>
        <span>{row.state}</span>
        <span style={{ color: colors.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.why}
        </span>
      </button>
    </li>
  );
}
