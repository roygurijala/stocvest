/**
 * Trading Room center-panel selection memory.
 *
 * Uses sessionStorage so selection survives hard refreshes within the same
 * session, but is cleared when the browser/tab is closed. This yields:
 *
 *   - Hard refresh → selection restored from URL query or sessionStorage
 *   - New browser session → Brief shows (no stale selection from yesterday)
 *   - SPA navigate away + back (same session) → selection restored
 *   - First visit each NY calendar day → Market Brief (market pulse)
 *
 * Cross-day persistence uses localStorage only for the last-visit ET date key.
 */
import { isoDateInNewYork } from "@/lib/market-hours-et";

const LAST_VISIT_ET_DATE_KEY = "stocvest:trading-room:last-visit-et-date";
const LAST_SELECTED_ID_KEY = "stocvest:trading-room:last-selected-id";

export function getLastSelectedId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(LAST_SELECTED_ID_KEY);
  } catch {
    return null;
  }
}

export function setLastSelectedId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) {
      window.sessionStorage.setItem(LAST_SELECTED_ID_KEY, id);
    } else {
      window.sessionStorage.removeItem(LAST_SELECTED_ID_KEY);
    }
  } catch {
    /* ignore storage errors */
  }
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

/** Test hook — reset sessionStorage between cases. */
export function __resetSessionSelectionForTests(): void {
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(LAST_SELECTED_ID_KEY);
    } catch {
      /* ignore */
    }
  }
}
