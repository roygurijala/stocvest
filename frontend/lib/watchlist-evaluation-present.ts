/** Copy for watchlist maturation / evaluation status (picker, command bar). */

import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

export const EVALUATION_MODE_LINES = [
  "Auto (daily refresh ~4:30 PM ET after cash close)",
  "Manual (when you open a symbol on Signals)"
] as const;

export function evaluationStatusTitle(mode: "swing" | "day"): string {
  return mode === "swing" ? "Swing evaluation status" : "Day evaluation status";
}

export function formatLastEvaluatedShort(iso: string | undefined): string | null {
  if (!iso?.trim()) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "shortGeneric"
    }).format(d);
  } catch {
    return null;
  }
}

/** Newest ``last_evaluated_at`` across maturation rows (for picker header). */
export function newestLastEvaluatedAt(
  bySymbol: Record<string, WatchlistMaturationRow>
): string | null {
  let best: number | null = null;
  let bestIso: string | null = null;
  for (const row of Object.values(bySymbol)) {
    const iso = row.last_evaluated_at;
    if (!iso) continue;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) continue;
    if (best === null || t > best) {
      best = t;
      bestIso = iso;
    }
  }
  return bestIso ? formatLastEvaluatedShort(bestIso) : null;
}

export function pickerRowIsEvaluated(row: WatchlistMaturationRow | undefined): boolean {
  return Boolean((row?.state || "").trim());
}

export function symbolHasMaturationRow(row: WatchlistMaturationRow | undefined): boolean {
  return Boolean((row?.state || row?.label || "").trim());
}

/** Count symbols with a maturation row on the active desk lens. */
export function countEvaluatedSymbols(
  symbols: string[],
  swingBySymbol: Record<string, WatchlistMaturationRow>,
  dayBySymbol: Record<string, WatchlistMaturationRow>,
  viewMode: "swing" | "day" | "both",
  dualDesk: boolean
): { evaluated: number; total: number } {
  const total = symbols.length;
  if (total === 0) return { evaluated: 0, total: 0 };
  let evaluated = 0;
  for (const sym of symbols) {
    const u = sym.trim().toUpperCase();
    if (!u) continue;
    const swing = symbolHasMaturationRow(swingBySymbol[u]);
    const day = dualDesk ? symbolHasMaturationRow(dayBySymbol[u]) : false;
    if (viewMode === "swing") {
      if (swing) evaluated += 1;
    } else if (viewMode === "day") {
      if (day) evaluated += 1;
    } else if (swing || day) {
      evaluated += 1;
    }
  }
  return { evaluated, total };
}

/** Header line under desk tabs — engine runs, not page fetch time. */
export function watchlistMaturationDeskSummary(
  symbols: string[],
  swingBySymbol: Record<string, WatchlistMaturationRow>,
  dayBySymbol: Record<string, WatchlistMaturationRow>,
  viewMode: "swing" | "day" | "both",
  dualDesk: boolean
): string | null {
  const { evaluated, total } = countEvaluatedSymbols(symbols, swingBySymbol, dayBySymbol, viewMode, dualDesk);
  if (total === 0) return null;
  const merged: Record<string, WatchlistMaturationRow> = { ...swingBySymbol };
  if (dualDesk) {
    for (const [sym, row] of Object.entries(dayBySymbol)) {
      const prev = merged[sym];
      if (!prev?.last_evaluated_at) merged[sym] = row;
      else if (row.last_evaluated_at && Date.parse(row.last_evaluated_at) > Date.parse(prev.last_evaluated_at)) {
        merged[sym] = row;
      }
    }
  }
  const lastRun = newestLastEvaluatedAt(merged);
  if (evaluated === 0) {
    return "No maturation runs on this desk yet — open a symbol on Signals (Evidence) or wait for weekday ~4:30 PM ET refresh";
  }
  if (lastRun) {
    return `${evaluated} of ${total} evaluated on this desk · last engine run ${lastRun}`;
  }
  return `${evaluated} of ${total} evaluated on this desk`;
}

export function watchlistUnevaluatedDeskHint(desk: "swing" | "day"): string {
  return desk === "swing"
    ? "Run swing Evidence on Signals to evaluate now, or wait for the weekday ~4:30 PM ET batch."
    : "Run day Evidence on Signals during the regular session, or wait for the weekday ~4:30 PM ET batch.";
}
