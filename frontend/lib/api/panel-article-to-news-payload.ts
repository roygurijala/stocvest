import type { NewsPayload } from "@/lib/api/market";
import type { TickerNewsArticle } from "@/lib/api/ticker-news-panel";

export function panelArticleToNewsPayload(article: TickerNewsArticle, symbolUpper: string): NewsPayload {
  const sent =
    article.sentiment_label === "bullish"
      ? "positive"
      : article.sentiment_label === "bearish"
        ? "negative"
        : "neutral";
  const url = article.url ?? "";
  return {
    article_id: article.id,
    id: article.id,
    title: article.title,
    tickers: [symbolUpper],
    published_at: article.published_at,
    published_utc: article.published_at,
    url,
    article_url: url,
    source: article.source_label,
    publisher: { name: article.source_label, tier: undefined },
    sentiment: sent,
    sentiment_score: article.sentiment_score,
    description: null,
    image_url: null
  };
}
