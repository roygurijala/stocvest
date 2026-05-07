import { panelArticleToNewsPayload } from "@/lib/api/panel-article-to-news-payload";
import { fetchTickerNewsPanel } from "@/lib/api/ticker-news-panel";

import type { NewsPayload } from "./market";

/** Polygon-backed articles for a single ticker; safe in Client Components (no `next/headers`). */
export async function fetchSymbolNews(
  symbol: string,
  limit = 10,
  opts?: { newsTradingMode?: "day" | "swing" }
): Promise<NewsPayload[]> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) {
    return [];
  }
  const capped = Math.min(100, Math.max(1, limit));
  const panel = await fetchTickerNewsPanel(sym, {
    days: 20,
    limit: capped,
    newsTradingMode: opts?.newsTradingMode ?? "day"
  });
  if (!panel?.articles?.length) {
    return [];
  }
  return panel.articles.slice(0, capped).map((a) => panelArticleToNewsPayload(a, sym));
}
