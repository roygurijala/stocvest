/**
 * Trading Room center-panel selection memory.
 *
 * Intentionally MODULE-SCOPED (not sessionStorage): the value lives as long as
 * the JS bundle is loaded. That yields exactly the desired UX:
 *
 *   - Hard refresh / fresh login  → bundle reloads → memory empty → Brief shows.
 *   - SPA navigate away + back (same trading day) → selection restored.
 *   - First visit each NY calendar day → Market Brief (market pulse), not yesterday's symbol.
 *
 * Cross-day persistence uses localStorage only for the last-visit ET date key.
 */
import { isoDateInNewYork } from "@/lib/market-hours-et";

const LAST_VISIT_ET_DATE_KEY = "stocvest:trading-room:last-visit-et-date";

let lastSelectedId: string | null = null;

export function getLastSelectedId(): string | null {
  return lastSelectedId;
}

export function setLastSelectedId(id: string | null): void {
  lastSelectedId = id;
}

/** True when the user has not opened the trading room yet this NY calendar day. */
export function isFirstVisitOfTradingDay(now: Date = new Date()): boolean {
  if (typeof window === "undefined") return false;
  const today = isoDateInNewYork(now);
  try {
    const stored = window.localStorage.getItem(LAST_VISIT_ET_DATE_KEY);
    if (!stored) return false;
    return stored !== today;
  } catch {
    return false;
  }
}

/** Record today's NY date after bootstrap (same-day revisits restore the last symbol). */
export function recordTradingRoomVisit(now: Date = new Date()): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_VISIT_ET_DATE_KEY, isoDateInNewYork(now));
  } catch {
    /* ignore */
  }
}

/** Test hook — reset module memory between cases. */
export function __resetSessionSelectionForTests(): void {
  lastSelectedId = null;
}
