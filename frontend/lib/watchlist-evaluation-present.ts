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
