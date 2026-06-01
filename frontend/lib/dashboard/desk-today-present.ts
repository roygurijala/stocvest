import type { GapIntelligenceItem } from "@/lib/api/scanner";
import type { DeskDiscoveryLeader, DeskTodayData, DeskTodayMode, DeskMoverRadarRow } from "@/lib/api/desk-today";
import { DESK_DISCOVERY_DISPLAY_LIMIT } from "@/lib/dashboard/desk-refresh-tiers";
import type { SessionActivityUiMode } from "@/lib/market/session-activity-mode";

const ET = "America/New_York";

function weekdayLongEt(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: ET, weekday: "long" }).format(now);
}

function isWeekendEt(now: Date = new Date()): boolean {
  const wd = weekdayLongEt(now);
  return wd === "Saturday" || wd === "Sunday";
}

export function formatDeskGapLine(gapPercent: number, direction: string): string {
  const pct = typeof gapPercent === "number" && Number.isFinite(gapPercent) ? gapPercent : 0;
  const sign = pct >= 0 ? "+" : "";
  const dir = direction === "down" ? "▼" : direction === "up" ? "▲" : "·";
  return `${dir} ${sign}${pct.toFixed(1)}% today`;
}

export function discoveryWhyLine(leader: DeskDiscoveryLeader): string {
  const gap = formatDeskGapLine(leader.gap_percent, leader.direction);
  if (leader.execution_hint?.trim()) return `${gap} · ${leader.execution_hint.trim()}`;
  if (leader.verdict?.trim()) return `${gap} · ${leader.verdict}`;
  return gap;
}

export function gapIntelToDiscoveryLeaders(
  items: GapIntelligenceItem[],
  mode: DeskTodayMode,
  limit = DESK_DISCOVERY_DISPLAY_LIMIT
): DeskDiscoveryLeader[] {
  return [...items]
    .sort((a, b) => {
      const sa = typeof a.gap_quality_score === "number" ? a.gap_quality_score : Math.abs(a.gap_pct);
      const sb = typeof b.gap_quality_score === "number" ? b.gap_quality_score : Math.abs(b.gap_pct);
      return sb - sa;
    })
    .slice(0, limit)
    .map((g) => ({
      symbol: g.symbol.trim().toUpperCase(),
      gap_percent: g.gap_pct,
      direction: g.gap_pct >= 0 ? "up" : "down",
      rank_score: typeof g.gap_quality_score === "number" ? g.gap_quality_score : Math.abs(g.gap_pct),
      desk: mode,
      verdict: g.has_catalyst ? "gap + catalyst" : null,
      execution_hint: null
    }));
}

function moversRadarToDiscoveryLeaders(
  movers: DeskMoverRadarRow[],
  mode: DeskTodayMode,
  limit = DESK_DISCOVERY_DISPLAY_LIMIT
): DeskDiscoveryLeader[] {
  return movers.slice(0, limit).map((m) => ({
    symbol: m.symbol.trim().toUpperCase(),
    gap_percent: m.gap_percent,
    direction: m.direction,
    rank_score: m.rank_score,
    desk: mode,
    verdict: null,
    execution_hint: null
  }));
}

export function resolveDiscoveryLeaders(
  deskData: DeskTodayData | null | undefined,
  gapFallback: GapIntelligenceItem[],
  mode: DeskTodayMode,
  alternateDeskData?: DeskTodayData | null | undefined
): { leaders: DeskDiscoveryLeader[]; source: "desk_cache" | "movers_radar" | "gap_fallback" | "empty" } {
  const fromDesk = deskData?.discovery;
  if (Array.isArray(fromDesk) && fromDesk.length > 0) {
    return { leaders: fromDesk.slice(0, DESK_DISCOVERY_DISPLAY_LIMIT), source: "desk_cache" };
  }
  const fromMovers = deskData?.movers_radar;
  if (Array.isArray(fromMovers) && fromMovers.length > 0) {
    return {
      leaders: moversRadarToDiscoveryLeaders(fromMovers, mode),
      source: "movers_radar"
    };
  }
  if (gapFallback.length > 0) {
    return { leaders: gapIntelToDiscoveryLeaders(gapFallback, mode), source: "gap_fallback" };
  }
  const altMovers = alternateDeskData?.movers_radar;
  if (Array.isArray(altMovers) && altMovers.length > 0) {
    return {
      leaders: moversRadarToDiscoveryLeaders(altMovers, mode),
      source: "movers_radar"
    };
  }
  return { leaders: [], source: "empty" };
}

export function deskScanFootnote(data: DeskTodayData | null | undefined): string | null {
  const eligible = data?.eligible_symbol_count;
  const scanned = data?.scanned_snapshot_count;
  if (typeof eligible !== "number" || eligible <= 0) return null;
  const survivorUsed =
    typeof data?.survivor_limit_used === "number" && data.survivor_limit_used > 0
      ? data.survivor_limit_used
      : null;
  const src =
    data?.snapshot_source === "liquid_fallback"
      ? "limited universe (plan fallback)"
      : "full market scan";
  const scannedPart = typeof scanned === "number" && scanned > 0 ? `${scanned.toLocaleString()} tickers · ` : "";
  const survivorPart = survivorUsed != null ? ` · top ${survivorUsed.toLocaleString()} retained` : "";
  return `${scannedPart}${eligible.toLocaleString()} passed filters (${src})${survivorPart}`;
}

export function formatGeneratedAtEt(iso: string | undefined): string | null {
  if (!iso?.trim()) return null;
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short"
    }).format(d);
  } catch {
    return null;
  }
}

export type DashboardPageTitleOpts = {
  /** When regular session is closed, do not imply live regime for the calendar day. */
  sessionMode?: SessionActivityUiMode;
};

/** H1 on dashboard pulse — regime belongs in the subline when session is closed. */
export function buildDashboardPageTitle(
  regimeLabel: string,
  opts?: DashboardPageTitleOpts
): string {
  const mode = opts?.sessionMode ?? "live";
  if (mode === "closed") {
    return isWeekendEt() ? "Weekend · Markets closed" : "Markets closed";
  }
  const regime = regimeLabel?.trim() || "Market";
  return `${weekdayLongEt()} · ${regime}`;
}

/** Prefix for regime + environment line when tape is not live. */
export function dashboardPulseHeadlinePrefix(sessionMode: SessionActivityUiMode): string | null {
  if (sessionMode === "closed") return "As of last close · ";
  if (sessionMode === "extended") return "Extended hours · ";
  return null;
}

export function dashboardPulseSessionHeading(sessionMode: SessionActivityUiMode): {
  title: string;
  subline: string;
} {
  if (sessionMode === "closed") {
    return {
      title: "Last session",
      subline: "Index moves at the last regular close — not live tape."
    };
  }
  if (sessionMode === "extended") {
    return {
      title: "Today (extended)",
      subline: "Index context during extended hours — intraday gates resume at the regular open."
    };
  }
  return {
    title: "Today (session)",
    subline: "Index moves since the open — live tape, not 5-day trend."
  };
}
