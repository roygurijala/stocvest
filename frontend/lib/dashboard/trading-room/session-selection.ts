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
 *   - Logout then login (same tab) → Market Brief (market pulse)
 *
 * Cross-day persistence uses localStorage only for the last-visit ET date key.
 */
import { clearTradingRoomOpenIntent } from "@/lib/nav/dashboard-trading-room-deeplink";
import { isoDateInNewYork } from "@/lib/market-hours-et";

const LAST_VISIT_ET_DATE_KEY = "stocvest:trading-room:last-visit-et-date";
const LAST_SELECTED_ID_KEY = "stocvest:trading-room:last-selected-id";
const POST_LOGIN_FRESH_KEY = "stocvest:trading-room:post-login-fresh";

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
    return !stored || stored !== today;
  } catch {
    return false;
  }
}

/** Set before logout so the next authenticated dashboard load opens Market Brief. */
export function markTradingRoomPostLoginFresh(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(POST_LOGIN_FRESH_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** One-shot flag consumed on dashboard bootstrap after sign-out → sign-in. */
export function consumeTradingRoomPostLoginFresh(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.sessionStorage.getItem(POST_LOGIN_FRESH_KEY);
    if (!raw) return false;
    window.sessionStorage.removeItem(POST_LOGIN_FRESH_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Clear in-tab trading room memory — call from logout buttons before redirect. */
export function clearTradingRoomClientSession(): void {
  setLastSelectedId(null);
  clearTradingRoomOpenIntent();
  markTradingRoomPostLoginFresh();
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
      window.sessionStorage.removeItem(POST_LOGIN_FRESH_KEY);
    } catch {
      /* ignore */
    }
  }
}
