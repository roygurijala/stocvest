/**
 * Missed today — educational copy for symbols that dropped off discovery.
 * Teaches timing and gates; does not encourage chasing session moves.
 */

import type { GapIntelligenceItem } from "@/lib/api/scanner";
import type { DeskMoverRadarRow, DeskRecentlyHotRow, DeskTodayData } from "@/lib/api/desk-today";
import { formatDeskGapLine } from "@/lib/dashboard/desk-today-present";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import { hotInMarketSignalsHref } from "@/lib/dashboard/hot-in-market-card-present";

export const MISSED_TODAY_TITLE = "Missed today";

export const MISSED_TODAY_INTRO =
  "Educational only — names that rolled off today's top discovery list. Use for context and timing lessons, not to chase moves.";

export type MissedTodayCardModel = {
  symbol: string;
  moveLine: string | null;
  lessonLine: string;
  detailLine: string | null;
  signalsHref: string;
};

const EXTENDED_GAP_UP_PCT = 12;
const MOMENTUM_GAP_UP_PCT = 6;

export function indexDeskMoversBySymbol(
  deskData: DeskTodayData | null | undefined
): Map<string, DeskMoverRadarRow> {
  const map = new Map<string, DeskMoverRadarRow>();
  for (const row of deskData?.movers_radar ?? []) {
    const sym = row.symbol.trim().toUpperCase();
    if (sym) map.set(sym, row);
  }
  return map;
}

function resolveGapAndDirection(
  row: DeskRecentlyHotRow,
  mover: DeskMoverRadarRow | undefined
): { gapPercent: number | null; direction: "up" | "down" | "flat" } {
  const gapRaw =
    typeof row.gap_percent === "number" && Number.isFinite(row.gap_percent)
      ? row.gap_percent
      : typeof mover?.gap_percent === "number" && Number.isFinite(mover.gap_percent)
        ? mover.gap_percent
        : null;
  if (gapRaw == null) {
    return { gapPercent: null, direction: "flat" };
  }
  const direction =
    mover?.direction === "up" || mover?.direction === "down"
      ? mover.direction
      : gapRaw > 0
        ? "up"
        : gapRaw < 0
          ? "down"
          : "flat";
  return { gapPercent: gapRaw, direction };
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function detailFromGapContext(symbol: string, gapFallback: GapIntelligenceItem[]): string | null {
  const sym = symbol.trim().toUpperCase();
  const hit = gapFallback.find((g) => g.symbol.trim().toUpperCase() === sym);
  if (!hit) return null;
  const warning = hit.no_catalyst_warning?.trim();
  if (warning) return warning;
  const headline = hit.catalyst?.headline?.trim();
  if (headline) return `Had catalyst: ${truncate(headline, 72)}`;
  if (hit.has_catalyst) return "Had a catalyst when gapped — still verify current gates on Signals.";
  return null;
}

function lessonForMove(gapPercent: number | null, direction: "up" | "down" | "flat"): string {
  if (direction === "down" || (gapPercent != null && gapPercent < -2)) {
    return "Faded after ranking — don't assume the same setup still holds.";
  }
  if (gapPercent != null && gapPercent >= EXTENDED_GAP_UP_PCT) {
    return "Was on the desk earlier — session likely extended; entries valid earlier may not meet R/R now.";
  }
  if (gapPercent != null && gapPercent >= MOMENTUM_GAP_UP_PCT) {
    return "Left the top list while still moving — momentum context only, not a fresh entry signal.";
  }
  if (gapPercent != null && gapPercent > 0) {
    return "Rolled off today's top discovery — open Signals for current alignment and gates.";
  }
  return "No longer in today's top discovery — check Signals before planning anything.";
}

function detailLineFromReason(reason: string | undefined): string | null {
  if (reason === "dropped_from_discovery") {
    return "Dropped after the last scheduled desk scan — timing matters as much as the move.";
  }
  return null;
}

function resolveDetailLine(
  row: DeskRecentlyHotRow,
  gapFallback: GapIntelligenceItem[]
): string | null {
  const parts = [detailFromGapContext(row.symbol, gapFallback), detailLineFromReason(row.reason)].filter(
    Boolean
  ) as string[];
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

export function buildMissedTodayCardModel(
  row: DeskRecentlyHotRow,
  opts: {
    mode: DashboardDeskMode;
    moversBySymbol: Map<string, DeskMoverRadarRow>;
    gapFallback?: GapIntelligenceItem[];
  }
): MissedTodayCardModel {
  const symbol = row.symbol.trim().toUpperCase();
  const mover = opts.moversBySymbol.get(symbol);
  const { gapPercent, direction } = resolveGapAndDirection(row, mover);
  const moveLine =
    gapPercent != null
      ? formatDeskGapLine(gapPercent, direction === "down" ? "down" : direction === "up" ? "up" : "up")
      : null;
  const lessonLine = lessonForMove(gapPercent, direction);
  const detailLine = resolveDetailLine(row, opts.gapFallback ?? []);

  return {
    symbol,
    moveLine,
    lessonLine,
    detailLine,
    signalsHref: hotInMarketSignalsHref(symbol, opts.mode)
  };
}

export function buildMissedTodayCardModels(
  rows: DeskRecentlyHotRow[],
  opts: {
    mode: DashboardDeskMode;
    deskData: DeskTodayData | null | undefined;
    gapFallback?: GapIntelligenceItem[];
    max?: number;
  }
): MissedTodayCardModel[] {
  const moversBySymbol = indexDeskMoversBySymbol(opts.deskData);
  const limit = opts.max ?? 5;
  return rows
    .slice(0, limit)
    .map((row) =>
      buildMissedTodayCardModel(row, {
        mode: opts.mode,
        moversBySymbol,
        gapFallback: opts.gapFallback
      })
    )
    .filter((m) => Boolean(m.symbol));
}
