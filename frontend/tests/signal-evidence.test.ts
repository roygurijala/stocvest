import { describe, expect, test } from "vitest";

import { buildEvidenceFromSetup } from "@/lib/signal-evidence";
import type { NewsPayload } from "@/lib/api/market";
import type { IntradaySetupPayload } from "@/lib/api/scanner";

const baseSetup: IntradaySetupPayload = {
  symbol: "AAPL",
  direction: "bullish",
  score: 0.72,
  triggers: ["Test"],
  timestamp_iso: new Date().toISOString()
};

describe("buildEvidenceFromSetup news layer", () => {
  test("uses symbol news count, title, and sentiment score when articles provided", () => {
    const articles: NewsPayload[] = [
      {
        article_id: "1",
        title: "Apple reports strong quarter",
        tickers: ["AAPL"],
        published_at: new Date().toISOString(),
        url: "https://example.com",
        sentiment_score: 0.42
      }
    ];
    const data = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: articles });
    const newsLayer = data.layers.find((l) => l.key === "news");
    expect(newsLayer?.keyPoints[0]).toBe("Articles 1");
    expect(newsLayer?.keyPoints[1]).toContain("0.42");
    expect(newsLayer?.keyPoints[2]).toContain("Apple");
    expect(newsLayer?.freshnessLabel).not.toContain("News unavailable");
    expect(data.newsFreshnessLabel).not.toContain("News unavailable");
  });

  test("shows No recent news for SYMBOL when article list is empty", () => {
    const data = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const newsLayer = data.layers.find((l) => l.key === "news");
    expect(newsLayer?.keyPoints[0]).toBe("Articles 0");
    expect(newsLayer?.keyPoints[2]).toBe("No recent news for AAPL");
    expect(newsLayer?.freshnessLabel).toBe("No recent news for AAPL");
    expect(data.newsFreshnessLabel).toBe("No recent news for AAPL");
  });
});
