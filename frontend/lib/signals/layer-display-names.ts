/**
 * User-facing labels for the six composite layer keys.
 * Internal ids stay `technical`, `news`, … `internals` — only display copy changes here.
 */

export const SIGNAL_LAYER_DISPLAY_NAMES: Record<string, string> = {
  technical: "Technical",
  news: "News",
  macro: "Macro",
  sector: "Sector",
  geopolitical: "Geopolitical",
  internals: "Market Internals"
};

export function signalLayerDisplayName(key: string): string {
  const k = key.trim().toLowerCase();
  return SIGNAL_LAYER_DISPLAY_NAMES[k] ?? key;
}
