/** Copy for watchlist maturation / evaluation status (picker, command bar). */

import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

export const EVALUATION_MODE_LINES = [
  "Scheduled: swing ~8:15 AM ET · day ~9:35 AM ET (RTH) · reconcile ~4:30 PM ET",
  "On demand: row Refresh or Evidence on Signals"
] as const;

export function evaluationStatusTitle(mode: "swing" | "day"): string {
  return mode === "swing" ? "Swing evaluation status" : "Day evaluation status";
}

export type WatchlistEvaluationLineOpts = {
  evaluating?: boolean;
  /** Regular session not open (Polygon `market` ≠ `open`). */
  sessionClosed?: boolean;
};

/** Row footer — always non-empty when shown. */
export function formatLastEvaluatedLine(iso: string | undefined, opts?: WatchlistEvaluationLineOpts): string {
  if (opts?.evaluating) return "Evaluating now…";
  const short = formatLastEvaluatedShort(iso);
  if (short) return `Last evaluated ${short}`;
  if (opts?.sessionClosed) return "No live run while market is closed";
  return "Not evaluated yet";
}

/** Pending desk status line (no maturation row yet). */
export function formatUnevaluatedDeskStatusLine(
  desk: "swing" | "day",
  opts?: WatchlistEvaluationLineOpts
): string {
  const tag = desk === "swing" ? "SWING" : "DAY";
  if (opts?.evaluating) return `${tag} · Evaluating…`;
  if (opts?.sessionClosed) return `${tag} · No run yet (market closed)`;
  return `${tag} · Not evaluated yet`;
}

/** Page-level maturation-summary fetch time (local clock). */
export function formatSummaryFetchedAt(when: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "shortGeneric"
  }).format(when);
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
  viewMode: "swing" | "day",
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
    if (viewMode === "day") {
      if (day) evaluated += 1;
    } else if (swing) {
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
  viewMode: "swing" | "day",
  dualDesk: boolean,
  opts?: { sessionClosed?: boolean }
): string | null {
  const { evaluated, total } = countEvaluatedSymbols(symbols, swingBySymbol, dayBySymbol, viewMode, dualDesk);
  if (total === 0) return null;
  const deskRows = viewMode === "day" && dualDesk ? dayBySymbol : swingBySymbol;
  const lastRun = newestLastEvaluatedAt(deskRows);
  const deskLabel = viewMode === "day" ? "Day" : "Swing";
  if (evaluated === 0) {
    if (opts?.sessionClosed) {
      return "Market is closed — day desk updates at the next 9:35 AM ET session or via Refresh / Evidence; swing at ~8:15 AM ET";
    }
    return "No maturation runs on this desk yet — use row Refresh, open Evidence on Signals, or wait for the weekday schedule";
  }
  if (lastRun) {
    return `${evaluated} of ${total} on ${deskLabel} desk · last run ${lastRun}`;
  }
  return `${evaluated} of ${total} on ${deskLabel} desk`;
}

export function watchlistUnevaluatedDeskHint(desk: "swing" | "day"): string {
  return desk === "swing"
    ? "Use row Refresh or swing Evidence now, or wait for weekday ~8:15 AM ET (and ~4:30 PM ET reconcile)."
    : "Use row Refresh or day Evidence during the session, or wait for weekday ~9:35 AM ET (and ~4:30 PM ET reconcile).";
}
