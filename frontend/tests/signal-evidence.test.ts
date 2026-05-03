import { describe, expect, test } from "vitest";

import {
  applySwingCompositeEnrichment,
  buildEvidenceFromSetup,
  parseSwingCompositeInsight
} from "@/lib/signal-evidence";
import type { NewsPayload } from "@/lib/api/market";
import type { IntradaySetupPayload } from "@/lib/api/scanner";

const baseSetup: IntradaySetupPayload = {
  symbol: "AAPL",
  direction: "bullish",
  score: 0.72,
  triggers: ["Test"],
  timestamp_iso: new Date().toISOString()
};

describe("buildEvidenceFromSetup direction", () => {
  test("maps long to bullish and preserves dashboard badge text", () => {
    const data = buildEvidenceFromSetup(
      { ...baseSetup, direction: "long" },
      undefined,
      { symbolNewsArticles: [] }
    );
    expect(data.direction).toBe("bullish");
    expect(data.directionBadgeLabel).toBe("long");
  });

  test("maps short to bearish", () => {
    const data = buildEvidenceFromSetup({ ...baseSetup, direction: "SHORT" }, undefined, { symbolNewsArticles: [] });
    expect(data.direction).toBe("bearish");
    expect(data.directionBadgeLabel).toBe("SHORT");
  });

  test("technical freshness is Just now for epoch stale timestamp", () => {
    const data = buildEvidenceFromSetup(
      { ...baseSetup, timestamp_iso: "1970-01-01T00:00:00.000Z" },
      undefined,
      { symbolNewsArticles: [] }
    );
    const tech = data.layers.find((l) => l.key === "technical");
    expect(tech?.freshnessLabel).toBe("Just now");
  });
});

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

describe("buildEvidenceFromSetup key levels", () => {
  test("uses Polygon day_vwap for VWAP when provided", () => {
    const data = buildEvidenceFromSetup(
      baseSetup,
      {
        symbol: "AAPL",
        last_trade_price: 200,
        day_vwap: 199.5,
        day_low: 198,
        day_high: 202
      },
      { symbolNewsArticles: [] }
    );
    expect(data.keyLevels.vwap).toBe(199.5);
    expect(data.keyLevels.support).toBe(198);
    expect(data.keyLevels.resistance).toBe(202);
  });
});

describe("parseSwingCompositeInsight", () => {
  test("maps swing-composite JSON into structured insight", () => {
    const insight = parseSwingCompositeInsight({
      signal_score: 82,
      trend_strength: "Strong",
      trend_direction: "Uptrend",
      risk_reward: 2.3,
      market_regime: "Bullish",
      confirming_signals: [{ label: "ORB Breakout", detail: "ok" }],
      conflicting_signals: [],
      catalysts: [{ text: "Beat", sentiment: "positive" }],
      risk_factors: ["Gap risk", "Liquidity", "Macro"],
      signal_parameters: "Observe vs zone.",
      historical_entry_zone: { low: 100, high: 102 },
      reference_target_1: 105,
      reference_target_2: 108,
      reference_stop_level: 99
    });
    expect(insight).not.toBeNull();
    expect(insight!.signal_score).toBe(82);
    expect(insight!.risk_reward).toBe(2.3);
    expect(insight!.confirming_signals[0]?.label).toBe("ORB Breakout");
    expect(insight!.historical_entry_zone?.low).toBe(100);
  });

  test("returns null when signal_score missing", () => {
    expect(parseSwingCompositeInsight({ trend_strength: "Weak" })).toBeNull();
  });
});

describe("applySwingCompositeEnrichment", () => {
  test("uses fallback insight for insufficient_data body", () => {
    const base = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const enriched = applySwingCompositeEnrichment(base, {
      status: "insufficient_data",
      message: "x",
      market_status: { is_market_open: true, next_open: null, market_session: "rth" }
    });
    expect(enriched.insight?.signal_score).toBeGreaterThanOrEqual(0);
    expect(enriched.insight?.trend_strength).toMatch(/Strong|Moderate|Weak/);
  });

  test("parses composite body and merges confluence when present", () => {
    const base = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const enriched = applySwingCompositeEnrichment(base, {
      signal_score: 71,
      trend_strength: "Moderate",
      trend_direction: "Uptrend",
      risk_reward: 2.1,
      market_regime: "Bullish",
      catalysts: [],
      risk_factors: ["A", "B", "C"],
      signal_parameters: "Test parameters prose.",
      historical_entry_zone: { low: 10, high: 11 },
      confluence_score: 72,
      confluence_tier: "moderate",
      is_confluence_alert: true,
      confirming_signals: [{ label: "Above VWAP" }],
      conflicting_signals: [],
      n_confirming: 3,
      n_conflicting: 0,
      historical_note: "",
      confluence_disclaimer: ""
    });
    expect(enriched.insight?.signal_score).toBe(71);
    expect(enriched.confluence?.confluence_score).toBe(72);
    expect(enriched.confluence?.confirming_signals[0]?.label).toBe("Above VWAP");
  });
});
