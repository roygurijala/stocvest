/**
 * Scanner Terminal — shared visual tokens (lane/state/sector color coding).
 * Mirrors Trading Room feed card semantics: lane left rail + state bottom rail.
 */

import type { CSSProperties } from "react";
import { borderRadius, roleAccents, typography, type CardTone, type ThemeColors } from "@/lib/design-system";
import type { FeedBias, FeedLane, FeedState } from "@/lib/dashboard/trading-room/feed-model";
import type { ScannerTerminalGapRow, ScannerTerminalSignalRow } from "@/lib/scanner/terminal/scanner-terminal-model";

export const STATE_LABEL: Record<FeedState, string> = {
  actionable: "Actionable",
  near: "Near",
  potential: "Potential",
  cooling: "Cooling"
};

/** Sector ETF accent rails for On radar theme cards. */
export const SECTOR_ETF_ACCENT: Record<string, string> = {
  XLK: "#818cf8",
  XLC: "#e879f9",
  XLE: "#34d399",
  XLF: "#fbbf24",
  XLY: "#f472b6",
  XLV: "#22d3ee",
  XLP: "#a78bfa",
  XLI: "#94a3b8",
  XLRE: "#fb923c",
  XLU: "#60a5fa",
  XLB: "#4ade80"
};

export function laneAccent(lane: FeedLane, theme: "dark" | "light" = "dark"): string {
  return lane === "day" ? roleAccents[theme].day.borderAccent : roleAccents[theme].swing.borderAccent;
}

export function stateTone(state: FeedState, colors: ThemeColors): string {
  if (state === "actionable") return colors.bullish;
  if (state === "near") return colors.caution;
  if (state === "cooling") return colors.bearish;
  return colors.textMuted;
}

export function gapTone(gapPct: number, colors: ThemeColors): CardTone {
  if (gapPct >= 1.5) return "bullish";
  if (gapPct <= -1.5) return "bearish";
  return gapPct >= 0 ? "bullish" : "bearish";
}

export function sectorAccentFromGroupId(groupId: string): string {
  const etf = groupId.replace(/^sector-/, "").toUpperCase();
  return SECTOR_ETF_ACCENT[etf] ?? "#64748b";
}

export function biasPillStyle(bias: FeedBias, colors: ThemeColors): CSSProperties {
  const tone = bias === "bull" ? colors.bullish : bias === "bear" ? colors.bearish : colors.textMuted;
  return {
    display: "inline-block",
    fontSize: typography.scale.xs,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: tone,
    background: `${tone}1f`,
    padding: "2px 8px",
    borderRadius: borderRadius.full
  };
}

export function signalCardChrome(
  row: ScannerTerminalSignalRow,
  selected: boolean,
  highlight: boolean,
  colors: ThemeColors
): CSSProperties {
  const lane = laneAccent(row.lane);
  const state = stateTone(row.state, colors);
  const surface =
    highlight || row.state === "actionable"
      ? "rgba(34,197,94,0.07)"
      : row.state === "near"
        ? "rgba(245,158,11,0.06)"
        : colors.surface;

  return {
    borderLeft: `3px solid ${lane}`,
    borderBottom: `3px solid ${state}`,
    borderTop: `1px solid ${selected ? colors.accent : "rgba(255,255,255,0.06)"}`,
    borderRight: `1px solid ${selected ? colors.accent : "rgba(255,255,255,0.06)"}`,
    background: selected ? "rgba(46,139,255,0.1)" : surface,
    boxShadow: selected
      ? `0 0 0 1px ${colors.accent}55, 0 8px 24px rgba(0,0,0,0.35)`
      : highlight
        ? "0 0 0 1px rgba(34,197,94,0.15), 0 6px 18px rgba(0,0,0,0.28)"
        : "0 4px 14px rgba(0,0,0,0.22)"
  };
}

export function gapCardChrome(
  row: ScannerTerminalGapRow,
  selected: boolean,
  colors: ThemeColors
): CSSProperties {
  const tone = row.gapPct >= 0 ? colors.bullish : colors.bearish;
  const strong = Math.abs(row.gapPct) >= 3;
  return {
    borderLeft: `3px solid ${tone}`,
    borderBottom: `3px solid ${strong ? tone : `${tone}88`}`,
    borderTop: `1px solid ${selected ? colors.accent : "rgba(255,255,255,0.06)"}`,
    borderRight: `1px solid ${selected ? colors.accent : "rgba(255,255,255,0.06)"}`,
    background: selected ? "rgba(46,139,255,0.1)" : row.gapPct >= 0 ? "rgba(34,197,94,0.05)" : "rgba(239,68,68,0.05)",
    boxShadow: selected
      ? `0 0 0 1px ${colors.accent}55, 0 8px 24px rgba(0,0,0,0.35)`
      : `0 0 0 1px ${tone}22, 0 4px 14px rgba(0,0,0,0.22)`
  };
}

export function selectionAccentColor(
  selection: {
    kind: "gap" | "signal" | "radar" | "lookup";
    groupId?: string;
    gapPct?: number;
    state?: FeedState;
  } | null,
  colors: ThemeColors
): string {
  if (!selection) return colors.accent;
  if (selection.kind === "lookup") return colors.accent;
  if (selection.kind === "gap") {
    if (selection.gapPct != null && selection.gapPct < 0) return colors.bearish;
    return colors.bullish;
  }
  if (selection.kind === "radar" && selection.groupId) return sectorAccentFromGroupId(selection.groupId);
  if (selection.state === "actionable") return colors.bullish;
  if (selection.state === "near") return colors.caution;
  return colors.textMuted;
}

export function radarCardChrome(groupId: string, selected: boolean, colors: ThemeColors): CSSProperties {
  const accent = sectorAccentFromGroupId(groupId);
  return {
    borderLeft: `3px solid ${accent}`,
    borderBottom: `3px solid ${accent}99`,
    borderTop: `1px solid ${selected ? colors.accent : "rgba(255,255,255,0.06)"}`,
    borderRight: `1px solid ${selected ? colors.accent : "rgba(255,255,255,0.06)"}`,
    background: selected ? "rgba(46,139,255,0.08)" : `linear-gradient(135deg, ${accent}12 0%, rgba(15,23,42,0.4) 100%)`,
    boxShadow: selected
      ? `0 0 0 1px ${colors.accent}55, 0 8px 24px rgba(0,0,0,0.35)`
      : `0 0 0 1px ${accent}22, 0 4px 14px rgba(0,0,0,0.22)`
  };
}
