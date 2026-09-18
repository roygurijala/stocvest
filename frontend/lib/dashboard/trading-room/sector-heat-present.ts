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
  /** Primary window move; null when Polygon has no usable daily close. */
  pct: number | null;
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

export function sectorHeatPrimaryPct(sector: SectorHeatInput, windowLabel: string): number | null {
  const useDaily = windowLabel === "today";
  const raw = useDaily
    ? (sector.pct1d ?? sector.pct5d ?? sector.pct)
    : (sector.pct5d ?? sector.pct1d ?? sector.pct);
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/** Floor so a quiet tape still draws readable bars. */
export const SECTOR_RANK_BAR_MAX_ABS_FLOOR = 0.5;

export function sectorRankMaxAbs(pcts: readonly (number | null | undefined)[]): number {
  const nums = pcts.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return SECTOR_RANK_BAR_MAX_ABS_FLOOR;
  return Math.max(SECTOR_RANK_BAR_MAX_ABS_FLOOR, ...nums.map((n) => Math.abs(n)));
}

/** Width of the colored bar as a percent of the full track (0–50, diverging from center). */
export function sectorRankBarTrackPct(pct: number | null | undefined, maxAbs: number): number {
  if (pct == null || !Number.isFinite(pct) || maxAbs <= 0) return 0;
  return Math.min(50, (Math.abs(pct) / maxAbs) * 50);
}

export function sortSectorsForRank<T extends SectorHeatInput>(
  sectors: readonly T[],
  windowLabel: string
): T[] {
  return [...sectors].sort((a, b) => {
    const ap = sectorHeatPrimaryPct(a, windowLabel);
    const bp = sectorHeatPrimaryPct(b, windowLabel);
    if (ap == null && bp == null) return a.label.localeCompare(b.label);
    if (ap == null) return 1;
    if (bp == null) return -1;
    if (bp !== ap) return bp - ap;
    return a.label.localeCompare(b.label);
  });
}

/** e.g. "7 of 11 sectors up · Tech leads, Communications lags" */
export function sectorBreadthCaption(
  sectors: readonly SectorHeatInput[],
  windowLabel: string
): string | null {
  const rows = sectors
    .map((sector) => ({ label: sector.label, pct: sectorHeatPrimaryPct(sector, windowLabel) }))
    .filter((row): row is { label: string; pct: number } => row.pct != null);
  if (rows.length === 0) return null;
  const up = rows.filter((row) => row.pct > 0.05).length;
  const sorted = [...rows].sort((a, b) => b.pct - a.pct);
  const lead = sorted[0];
  const lag = sorted[sorted.length - 1];
  const parts = [`${up} of ${rows.length} sectors up`];
  if (lead && lag && lead.label !== lag.label && (lead.pct > 0.05 || lag.pct < -0.05)) {
    parts.push(`${lead.label} leads, ${lag.label} lags`);
  }
  return parts.join(" · ");
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

/** Label when Polygon has no usable quote (halted, illiquid, or delisted). */
export function formatHeatMissingQuote(): string {
  return "N/A";
}
