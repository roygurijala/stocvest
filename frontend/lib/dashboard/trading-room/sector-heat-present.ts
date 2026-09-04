/**
 * ADR-003 UX-D6 — Sector heat grid presentation (pure).
 *
 * Compact ETF + optional holdings cells colored by session / window move.
 */

import type { CSSProperties } from "react";
import type { ThemeColors } from "@/lib/design-system";

export const SECTOR_HEAT_MAX_HOLDINGS = 8;

/** Intensity cap — moves beyond this saturate cell color. */
export const SECTOR_HEAT_PCT_SATURATION = 2.5;

export interface SectorHeatInput {
  symbol: string;
  label: string;
  pct: number;
  pct1d?: number | null;
  pct5d?: number | null;
}

export interface SectorHeatColors {
  bullish: string;
  bearish: string;
  text: string;
  textMuted: string;
  accent: string;
  surface: string;
  surfaceMuted: string;
}

export function sectorHeatPrimaryPct(sector: SectorHeatInput, windowLabel: string): number {
  const useDaily = windowLabel === "today";
  if (useDaily) {
    return sector.pct1d ?? sector.pct5d ?? sector.pct;
  }
  return sector.pct5d ?? sector.pct1d ?? sector.pct;
}

export function sectorHeatIntensity(pct: number, saturation = SECTOR_HEAT_PCT_SATURATION): number {
  if (!Number.isFinite(pct) || saturation <= 0) return 0;
  return Math.min(Math.abs(pct) / saturation, 1);
}

export function sectorHeatCellBackground(
  pct: number,
  colors: SectorHeatColors,
  opts?: { selected?: boolean; saturation?: number }
): string {
  const intensity = sectorHeatIntensity(pct, opts?.saturation);
  const baseAlpha = opts?.selected ? 0.42 : 0.28;
  const alpha = baseAlpha * (0.35 + intensity * 0.65);
  const tone = pct >= 0 ? colors.bullish : colors.bearish;
  return `${tone}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

export function sectorHeatGridColumns(cellCount: number): string {
  if (cellCount <= 4) return "repeat(2, minmax(0, 1fr))";
  if (cellCount <= 6) return "repeat(3, minmax(0, 1fr))";
  return "repeat(4, minmax(0, 1fr))";
}

export function sectorHeatCellStyle(
  pct: number,
  colors: ThemeColors,
  opts?: { selected?: boolean }
): CSSProperties {
  const heatColors: SectorHeatColors = {
    bullish: colors.bullish,
    bearish: colors.bearish,
    text: colors.text,
    textMuted: colors.textMuted,
    accent: colors.accent,
    surface: colors.surface,
    surfaceMuted: colors.surfaceMuted
  };
  const tone = pct >= 0 ? colors.bullish : colors.bearish;
  return {
    background: sectorHeatCellBackground(pct, heatColors, { selected: opts?.selected }),
    boxShadow: opts?.selected ? `inset 0 0 0 2px ${tone}` : `inset 0 0 0 1px ${colors.border}55`
  };
}

export function formatSectorHeatPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}
