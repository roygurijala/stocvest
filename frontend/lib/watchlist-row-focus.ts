/** Duration for scroll-to-row highlight ring on the watchlist. */
export const WATCHLIST_ROW_HIGHLIGHT_MS = 2400;

export function watchlistRowElementId(symbol: string): string {
  return `watchlist-row-${symbol.trim().toUpperCase()}`;
}

/** Scroll a watchlist card into view and pulse an outline highlight. Returns false if the row is missing. */
export function focusWatchlistRow(
  symbol: string,
  accentColor: string,
  options?: { block?: ScrollLogicalPosition; behavior?: ScrollBehavior }
): boolean {
  if (typeof document === "undefined") return false;
  const el = document.getElementById(watchlistRowElementId(symbol));
  if (!el) return false;
  window.requestAnimationFrame(() => {
    el.scrollIntoView({
      block: options?.block ?? "center",
      behavior: options?.behavior ?? "smooth"
    });
    el.classList.add("watchlist-row-highlight");
    el.style.setProperty("--watchlist-highlight-color", accentColor);
    window.setTimeout(() => {
      el.classList.remove("watchlist-row-highlight");
      el.style.removeProperty("--watchlist-highlight-color");
    }, WATCHLIST_ROW_HIGHLIGHT_MS);
  });
  return true;
}
