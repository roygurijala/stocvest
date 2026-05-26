import type { GapIntelligenceItem } from "@/lib/api/scanner";
import type { DeskDiscoveryLeader, DeskTodayData, DeskTodayMode } from "@/lib/api/desk-today";
import { DESK_DISCOVERY_DISPLAY_LIMIT } from "@/lib/dashboard/desk-refresh-tiers";

export function formatDeskGapLine(gapPercent: number, direction: string): string {
  const sign = gapPercent >= 0 ? "+" : "";
  const dir = direction === "down" ? "▼" : direction === "up" ? "▲" : "·";
  return `${dir} ${sign}${gapPercent.toFixed(1)}% today`;
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

export function resolveDiscoveryLeaders(
  deskData: DeskTodayData | null | undefined,
  gapFallback: GapIntelligenceItem[],
  mode: DeskTodayMode
): { leaders: DeskDiscoveryLeader[]; source: "desk_cache" | "gap_fallback" | "empty" } {
  const fromDesk = deskData?.discovery;
  if (Array.isArray(fromDesk) && fromDesk.length > 0) {
    return { leaders: fromDesk.slice(0, DESK_DISCOVERY_DISPLAY_LIMIT), source: "desk_cache" };
  }
  if (gapFallback.length > 0) {
    return { leaders: gapIntelToDiscoveryLeaders(gapFallback, mode), source: "gap_fallback" };
  }
  return { leaders: [], source: "empty" };
}

export function deskScanFootnote(data: DeskTodayData | null | undefined): string | null {
  const eligible = data?.eligible_symbol_count;
  const scanned = data?.scanned_snapshot_count;
  if (typeof eligible !== "number" || eligible <= 0) return null;
  const src =
    data?.snapshot_source === "liquid_fallback"
      ? "limited universe (plan fallback)"
      : "full market scan";
  const scannedPart = typeof scanned === "number" && scanned > 0 ? `${scanned.toLocaleString()} tickers · ` : "";
  return `${scannedPart}${eligible.toLocaleString()} passed filters (${src})`;
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

export function buildDashboardPageTitle(regimeLabel: string): string {
  const now = new Date();
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long"
  }).format(now);
  const regime = regimeLabel?.trim() || "Market";
  return `${weekday} · ${regime}`;
}
