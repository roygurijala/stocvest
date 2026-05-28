/**
 * Scanner evaluation universe — watchlist ∪ gap leaders ∪ Opportunity Desk (D13 Phase 5).
 */

import type { GapIntelligenceItem } from "@/lib/api/scanner";
import type { DeskTodayData } from "@/lib/api/desk-today";

/** Tape anchors always included before cap. */
export const SCANNER_MARKET_ANCHORS = ["SPY", "QQQ"] as const;

/** Max symbols evaluated for dashboard + scanner pattern loads (bars/setups). */
export const DASHBOARD_SCANNER_MAX_UNIVERSE = 50;

/** Gap rows merged into universe (API may return fewer). */
export const GAP_UNIVERSE_TOP_N = 30;

/** Discovery leaders from desk cache per mode. */
export const DESK_DISCOVERY_UNIVERSE_LIMIT = 15;

/** Movers radar (Tier B) symbols merged into universe. */
export const DESK_MOVERS_RADAR_UNIVERSE_LIMIT = 30;

/** Quiet leaders (low-velocity structure) merged into scanner universe. */
export const DESK_QUIET_LEADERS_UNIVERSE_LIMIT = 15;

/** Watchlist symbols always kept when capping scanner universe (desk/gap may fill the cap). */
export const WATCHLIST_UNIVERSE_RESERVE = 10;

export type DeskUniverseSlice = {
  discovery?: Array<{ symbol?: string }> | null;
  movers_radar?: Array<{ symbol?: string }> | null;
  quiet_leaders?: Array<{ symbol?: string }> | null;
};

export function normalizeSymbol(s: string): string {
  return s.trim().toUpperCase();
}

export function topGapSymbolsForUniverse(
  gapItems: GapIntelligenceItem[],
  limit = GAP_UNIVERSE_TOP_N
): string[] {
  return [...gapItems]
    .sort((a, b) => {
      const ga = typeof a.gap_quality_score === "number" ? a.gap_quality_score : Math.abs(a.gap_pct);
      const gb = typeof b.gap_quality_score === "number" ? b.gap_quality_score : Math.abs(b.gap_pct);
      return gb - ga;
    })
    .slice(0, limit)
    .map((g) => normalizeSymbol(g.symbol))
    .filter(Boolean);
}

export function symbolsFromDeskSlice(
  data: DeskUniverseSlice | null | undefined,
  opts?: { discoveryLimit?: number; moversLimit?: number; quietLimit?: number }
): string[] {
  if (!data) return [];
  const discoveryLimit = opts?.discoveryLimit ?? DESK_DISCOVERY_UNIVERSE_LIMIT;
  const moversLimit = opts?.moversLimit ?? DESK_MOVERS_RADAR_UNIVERSE_LIMIT;
  const out: string[] = [];
  const seen = new Set<string>();
  const discovery = Array.isArray(data.discovery) ? data.discovery : [];
  for (const row of discovery.slice(0, discoveryLimit)) {
    const sym = normalizeSymbol(String(row?.symbol ?? ""));
    if (sym && !seen.has(sym)) {
      seen.add(sym);
      out.push(sym);
    }
  }
  const movers = Array.isArray(data.movers_radar) ? data.movers_radar : [];
  for (const row of movers.slice(0, moversLimit)) {
    const sym = normalizeSymbol(String(row?.symbol ?? ""));
    if (sym && !seen.has(sym)) {
      seen.add(sym);
      out.push(sym);
    }
  }
  const quietLimit = opts?.quietLimit ?? DESK_QUIET_LEADERS_UNIVERSE_LIMIT;
  const quiet = Array.isArray(data.quiet_leaders) ? data.quiet_leaders : [];
  for (const row of quiet.slice(0, quietLimit)) {
    const sym = normalizeSymbol(String(row?.symbol ?? ""));
    if (sym && !seen.has(sym)) {
      seen.add(sym);
      out.push(sym);
    }
  }
  return out;
}

export function symbolsFromDeskPayloads(
  payloads: Array<DeskTodayData | null | undefined>
): string[] {
  const merged: string[] = [];
  for (const data of payloads) {
    merged.push(...symbolsFromDeskSlice(data));
  }
  return [...new Set(merged)];
}

export function buildScannerSymbolUniverse(parts: {
  anchors?: readonly string[];
  watchlist: string[];
  gapSymbols: string[];
  deskSymbols: string[];
  fallbackSymbols?: readonly string[];
}): string[] {
  const anchors = parts.anchors ?? SCANNER_MARKET_ANCHORS;
  const merged = [
    ...anchors.map(normalizeSymbol),
    ...parts.deskSymbols.map(normalizeSymbol),
    ...parts.gapSymbols.map(normalizeSymbol),
    ...parts.watchlist.map(normalizeSymbol)
  ].filter(Boolean);
  const unique = [...new Set(merged)];
  if (unique.length > 0) return unique;
  const fb = parts.fallbackSymbols ?? [];
  return [...new Set(fb.map(normalizeSymbol).filter(Boolean))];
}

export type CapScannerUniverseOptions = {
  watchlist?: string[];
  watchlistReserve?: number;
};

/**
 * Cap universe while preserving anchors, reserved watchlist slots, then priority order.
 */
export function capScannerUniverse(
  universe: string[],
  max: number,
  priority: string[],
  options?: CapScannerUniverseOptions
): string[] {
  if (universe.length <= max) return universe;
  const reserve = Math.max(0, options?.watchlistReserve ?? 0);
  const watchlist = [...new Set((options?.watchlist ?? []).map(normalizeSymbol).filter(Boolean))];
  const reservedWatch: string[] = [];
  for (const w of watchlist) {
    if (reservedWatch.length >= reserve) break;
    if (universe.includes(w) && !reservedWatch.includes(w)) reservedWatch.push(w);
  }

  const pri = [...new Set(priority.map(normalizeSymbol).filter(Boolean))];
  const out: string[] = [...reservedWatch];
  for (const p of pri) {
    if (out.length >= max) break;
    if (universe.includes(p) && !out.includes(p)) out.push(p);
  }
  for (const s of universe) {
    if (out.length >= max) break;
    if (!out.includes(s)) out.push(s);
  }
  const tail = out.filter((s) => !reservedWatch.includes(s));
  const room = Math.max(0, max - reservedWatch.length);
  return [...reservedWatch, ...tail.slice(0, room)];
}

export function scannerUniverseCapPriority(parts: {
  deskSymbols: string[];
  gapSymbols: string[];
  watchlist: string[];
}): string[] {
  return [
    ...SCANNER_MARKET_ANCHORS,
    ...parts.deskSymbols,
    ...parts.gapSymbols,
    ...parts.watchlist
  ];
}
