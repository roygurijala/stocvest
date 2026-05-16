/** Rotates empty-news phrasing (same intent as `stocvest.signals.news_copy`). */

export const NEWS_NO_ACTIVE_CATALYST = "No active catalyst";

export function pickNewsEmptyCopy(symbol: string): string {
  const sym = symbol.trim().toUpperCase() || "TICKER";
  return `${NEWS_NO_ACTIVE_CATALYST} for ${sym} in the lookback window.`;
}
