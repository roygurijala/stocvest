/** Presentation-layer helpers: tracking prefs filter visibility, not engine evaluation. */

import type { WatchlistDeskTracking } from "@/lib/watchlist-symbol-tracking";
import { defaultDeskTracking } from "@/lib/watchlist-symbol-tracking";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import { formatWatchlistMaturationLabel } from "@/lib/watchlist-page-utils";
import type { WatchlistViewMode } from "@/lib/watchlist-page-utils";

export type SymbolTrackingMap = Record<string, WatchlistDeskTracking>;

const STATE_RANK: Record<string, number> = {
  actionable: 5,
  developing: 4,
  re_evaluating: 3,
  not_aligned: 2,
  invalidated: 1
};

export function trackingForSymbol(
  map: SymbolTrackingMap | undefined,
  symbol: string,
  dualDesk: boolean
): WatchlistDeskTracking {
  const sym = symbol.trim().toUpperCase();
  return map?.[sym] ?? defaultDeskTracking(dualDesk);
}

export function tracksDesk(tracking: WatchlistDeskTracking, desk: "swing" | "day"): boolean {
  return desk === "swing" ? tracking.swing : tracking.day;
}

export function shouldShowDeskRow(
  tracking: WatchlistDeskTracking,
  desk: "swing" | "day",
  viewMode: WatchlistViewMode,
  dualDesk: boolean
): boolean {
  if (!tracksDesk(tracking, desk)) return false;
  if (!dualDesk) return desk === "swing";
  if (viewMode === "both") return true;
  return viewMode === desk;
}

/** Best maturation state among enabled desks only (for sorting / dashboard counts). */
export function presentationMaturationState(
  sym: string,
  trackingMap: SymbolTrackingMap | undefined,
  swing: WatchlistMaturationRow | undefined,
  day: WatchlistMaturationRow | undefined,
  dualDesk: boolean
): string | undefined {
  const t = trackingForSymbol(trackingMap, sym, dualDesk);
  const candidates: string[] = [];
  if (t.swing && swing?.state) candidates.push(swing.state);
  if (dualDesk && t.day && day?.state) candidates.push(day.state);
  if (!candidates.length) {
    if (t.swing && swing?.state) return swing.state;
    if (dualDesk && t.day && day?.state) return day.state;
    return undefined;
  }
  let best = candidates[0];
  let bestRank = STATE_RANK[best.toLowerCase()] ?? 0;
  for (const st of candidates.slice(1)) {
    const r = STATE_RANK[st.toLowerCase()] ?? 0;
    if (r > bestRank) {
      best = st;
      bestRank = r;
    }
  }
  return best;
}

export function presentationStateRank(
  sym: string,
  trackingMap: SymbolTrackingMap | undefined,
  swing: WatchlistMaturationRow | undefined,
  day: WatchlistMaturationRow | undefined,
  dualDesk: boolean
): number {
  const st = presentationMaturationState(sym, trackingMap, swing, day, dualDesk);
  return STATE_RANK[(st || "").toLowerCase()] ?? 0;
}

/** Swing-first when ties; deprioritize symbols with no tracked desks (should not happen). */
export function compareSymbolsByPresentationPriority(
  a: string,
  b: string,
  trackingMap: SymbolTrackingMap | undefined,
  swingMap: Record<string, WatchlistMaturationRow>,
  dayMap: Record<string, WatchlistMaturationRow>,
  dualDesk: boolean
): number {
  const ra = presentationStateRank(a, trackingMap, swingMap[a], dayMap[a], dualDesk);
  const rb = presentationStateRank(b, trackingMap, swingMap[b], dayMap[b], dualDesk);
  if (rb !== ra) return rb - ra;
  const ta = trackingForSymbol(trackingMap, a, dualDesk);
  const tb = trackingForSymbol(trackingMap, b, dualDesk);
  const boostA = (ta.swing ? 1 : 0) + (dualDesk && ta.day ? 1 : 0);
  const boostB = (tb.swing ? 1 : 0) + (dualDesk && tb.day ? 1 : 0);
  if (boostB !== boostA) return boostB - boostA;
  return a.localeCompare(b);
}

export function maturationAlertPassesTracking(
  symbol: string,
  mode: string | undefined,
  trackingMap: SymbolTrackingMap | undefined,
  dualDesk: boolean
): boolean {
  const sym = symbol.trim().toUpperCase();
  const m = (mode || "").trim().toLowerCase();
  if (m !== "swing" && m !== "day") return true;
  return tracksDesk(trackingForSymbol(trackingMap, sym, dualDesk), m);
}

export function parseMaturationModeFromAlertBody(body: unknown): "swing" | "day" | undefined {
  if (!body) return undefined;
  let parsed: unknown = body;
  if (typeof body === "string") {
    try {
      parsed = JSON.parse(body);
    } catch {
      return undefined;
    }
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const m = String((parsed as { mode?: unknown }).mode ?? "")
    .trim()
    .toLowerCase();
  if (m === "swing" || m === "day") return m;
  return undefined;
}

export function formatDeskMaturationSnippet(row: WatchlistMaturationRow | undefined): string {
  const label = formatWatchlistMaturationLabel(row);
  return label === "—" ? "Not evaluated yet" : label;
}
