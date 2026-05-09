/** Rotates empty-news phrasing (same intent as `stocvest.signals.news_copy`). */

export function pickNewsEmptyCopy(symbol: string): string {
  const sym = symbol.trim().toUpperCase() || "TICKER";
  let h = 0;
  for (let i = 0; i < sym.length; i++) {
    h = (h * 31 + sym.charCodeAt(i)) >>> 0;
  }
  const idx = h % 3;
  if (idx === 0) {
    return `No qualifying news for ${sym} in the lookback window. No active negative catalyst detected.`;
  }
  if (idx === 1) {
    return `No material news impacting ${sym} in the lookback window. No company-specific catalysts detected.`;
  }
  return `No company-specific catalysts detected in the filtered feed. Nothing material on ${sym} cleared quality filters in the window.`;
}
