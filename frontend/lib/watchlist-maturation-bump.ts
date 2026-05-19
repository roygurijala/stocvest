/** Cross-route hint: Signals composite finished — watchlist should refetch maturation-summary. */

export const WATCHLIST_MATURATION_UPDATED_EVENT = "stocvest:watchlist-maturation-updated";

const STORAGE_KEY = "stocvest:watchlist-maturation-bump";
const BUMP_TTL_MS = 10 * 60 * 1000;

type BumpPayload = { symbol: string; mode: "swing" | "day"; at: number };

export function notifyWatchlistMaturationUpdated(symbol: string, mode: "swing" | "day"): void {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return;
  const payload: BumpPayload = { symbol: sym, mode, at: Date.now() };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* private mode / quota */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(WATCHLIST_MATURATION_UPDATED_EVENT, { detail: { symbol: sym, mode } })
    );
  }
}

/** Returns true when a recent composite run should trigger a maturation-summary reload. */
export function consumeWatchlistMaturationBump(): boolean {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    sessionStorage.removeItem(STORAGE_KEY);
    const parsed = JSON.parse(raw) as Partial<BumpPayload>;
    if (typeof parsed.at !== "number" || Date.now() - parsed.at > BUMP_TTL_MS) return false;
    return Boolean(parsed.symbol?.trim());
  } catch {
    return false;
  }
}
