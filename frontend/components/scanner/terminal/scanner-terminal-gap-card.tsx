"use client";

import { borderRadius, spacing, typography, type ThemeColors } from "@/lib/design-system";
import { gapTimeHorizonLabel } from "@/lib/scanner/gap-time-horizon";
import {
  enrichGapRowFromSnapshot,
  formatGapPriceContext,
  gapCatalystBody,
  gapStatusDisplayLabel
} from "@/lib/scanner/terminal/enrich-gap-rows";
import { gapCardChrome } from "@/lib/scanner/terminal/scanner-terminal-present";
import type { ScannerTerminalGapRow } from "@/lib/scanner/terminal/scanner-terminal-model";
import type { SnapshotPayload } from "@/lib/api/market";

type Props = {
  row: ScannerTerminalGapRow;
  selected: boolean;
  onSelect: () => void;
  colors: ThemeColors;
  snapshot?: SnapshotPayload | null;
  companyFallback?: string | null;
};

function statusTagStyle(label: string, colors: ThemeColors): { background: string; color: string } {
  if (label.includes("IPO")) return { background: "rgba(168,85,247,0.18)", color: "#c084fc" };
  if (label === "gap accepted") return { background: "rgba(34,197,94,0.18)", color: colors.bullish };
  if (label === "fill watch") return { background: "rgba(239,68,68,0.18)", color: colors.bearish };
  return { background: "rgba(245,158,11,0.18)", color: colors.caution };
}

export function ScannerTerminalGapCard({
  row,
  selected,
  onSelect,
  colors,
  snapshot,
  companyFallback
}: Props) {
  const enriched = enrichGapRowFromSnapshot(row, snapshot, companyFallback);
  const statusLabel = gapStatusDisplayLabel(enriched);
  const statusStyle = statusTagStyle(statusLabel, colors);
  const priceContext = formatGapPriceContext(enriched);
  const catalyst = gapCatalystBody(enriched);
  const pctTone = enriched.isIpoWatch
    ? colors.accent
    : enriched.gapPct >= 0
      ? colors.bullish
      : colors.bearish;
  const chrome = gapCardChrome(enriched, selected, colors);

  return (
    <button
      type="button"
      className="scanner-terminal-card"
      onClick={onSelect}
      style={{
        padding: spacing[3],
        textAlign: "left",
        width: "100%",
        cursor: "pointer",
        ...chrome,
        ...(enriched.isIpoWatch
          ? {
              borderStyle: "dashed",
              borderColor: "rgba(168,85,247,0.45)",
              background: selected ? "rgba(46,139,255,0.1)" : "rgba(168,85,247,0.06)"
            }
          : null)
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: spacing[2] }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: typography.scale.base, fontWeight: 700, color: colors.text }}>{enriched.symbol}</div>
          {enriched.company ? (
            <div
              style={{
                marginTop: 2,
                fontSize: typography.scale.xs,
                color: colors.textMuted,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis"
              }}
            >
              {enriched.company}
            </div>
          ) : null}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          {enriched.isIpoWatch ? (
            <span style={{ fontSize: typography.scale.sm, fontWeight: 700, color: colors.accent }}>IPO</span>
          ) : (
            <span
              style={{
                fontSize: typography.scale.sm,
                fontWeight: 700,
                color: pctTone,
                fontVariantNumeric: "tabular-nums"
              }}
            >
              {enriched.gapPct >= 0 ? "+" : ""}
              {enriched.gapPct.toFixed(1)}%
            </span>
          )}
          {priceContext ? (
            <div
              style={{
                marginTop: 2,
                fontSize: 10,
                color: colors.textMuted,
                fontVariantNumeric: "tabular-nums",
                maxWidth: 168,
                lineHeight: 1.35
              }}
            >
              {priceContext}
            </div>
          ) : null}
        </div>
      </div>

      <div
        style={{
          marginTop: spacing[2],
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: spacing[2]
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "lowercase",
            padding: "2px 8px",
            borderRadius: borderRadius.full,
            background: statusStyle.background,
            color: statusStyle.color
          }}
        >
          {statusLabel}
        </span>
        {!enriched.isIpoWatch && enriched.volumeVsAvg > 0 ? (
          <span style={{ fontSize: 10, color: colors.textMuted, fontVariantNumeric: "tabular-nums" }}>
            Vol {enriched.volumeVsAvg.toFixed(1)}× avg
          </span>
        ) : enriched.isIpoWatch ? (
          <span style={{ fontSize: 10, color: colors.textMuted }}>Signal engine blocked — day 1</span>
        ) : null}
        <span style={{ fontSize: 10, color: colors.textMuted }}>
          ⏱ {gapTimeHorizonLabel(enriched.timeHorizon)}
        </span>
      </div>

      {catalyst ? (
        <p
          style={{
            margin: `${spacing[2]} 0 0`,
            fontSize: typography.scale.xs,
            color: catalyst.italic ? colors.textMuted : colors.text,
            fontStyle: catalyst.italic ? "italic" : "normal",
            lineHeight: 1.5
          }}
        >
          {catalyst.text}
        </p>
      ) : null}
    </button>
  );
}
