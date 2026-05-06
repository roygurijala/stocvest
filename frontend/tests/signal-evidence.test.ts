import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { SignalEvidenceCard } from "@/components/signal-evidence-card";
import { ThemeProvider } from "@/lib/theme-provider";
import {
  applySwingCompositeEnrichment,
  buildEvidenceFromSetup,
  deriveEvidenceInsightFallback,
  extractGeopoliticalLayerExtras,
  parseSwingCompositeInsight,
  referenceLevelsFromSessionStructure
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

  test("does not show No recent news when articles exist but first row lacks title", () => {
    const articles: NewsPayload[] = Array.from({ length: 9 }, (_, i) => ({
      article_id: `x${i}`,
      title: i === 3 ? "Fed minutes lift tech sentiment into close" : "",
      tickers: ["AAPL"],
      published_at: new Date().toISOString(),
      url: "https://example.com"
    }));
    const data = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: articles });
    const newsLayer = data.layers.find((l) => l.key === "news");
    expect(newsLayer?.keyPoints[0]).toBe("Articles 9");
    expect(newsLayer?.keyPoints[2]).toContain("Fed minutes");
    expect(newsLayer?.freshnessLabel).not.toContain("No recent news");
  });

  test("uses count line when articles exist but no snippet text on any row", () => {
    const articles: NewsPayload[] = Array.from({ length: 9 }, (_, i) => ({
      article_id: `y${i}`,
      title: "   ",
      description: null,
      tickers: ["AAPL"],
      published_at: "2026-01-15T14:00:00.000Z",
      url: "https://example.com"
    }));
    const data = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: articles });
    const newsLayer = data.layers.find((l) => l.key === "news");
    expect(newsLayer?.keyPoints[2]).toBe("9 recent articles");
    expect(newsLayer?.freshnessLabel).toMatch(/^News /);
  });
});

describe("buildEvidenceFromSetup layer key points", () => {
  test("technical uses last / change / VWAP from snapshot when present", () => {
    const data = buildEvidenceFromSetup(
      baseSetup,
      {
        symbol: "AAPL",
        last_trade_price: 100,
        prev_close: 99,
        day_vwap: 99.5,
        day_low: 98.5,
        day_high: 101
      },
      { symbolNewsArticles: [] }
    );
    const tech = data.layers.find((l) => l.key === "technical");
    expect(tech?.keyPoints[0]).toContain("$100.00");
    expect(tech?.keyPoints[1]).toContain("prev close");
    expect(tech?.keyPoints[2]).toContain("VWAP");
  });

  test("macro layer shows descriptive bullets not em dashes", () => {
    const data = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const macro = data.layers.find((l) => l.key === "macro");
    expect(macro?.keyPoints.every((p) => p !== "—")).toBe(true);
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
    expect(data.lastTradePrice).toBe(200);
  });
});

describe("session reference levels and fallback R/R", () => {
  test("referenceLevelsFromSessionStructure matches swing long geometry (no % buffer on high)", () => {
    const lv = referenceLevelsFromSessionStructure({
      direction: "bullish",
      support: 98,
      resistance: 102,
      vwap: 99.5,
      lastTradePrice: 100,
      prevClose: 99
    });
    expect(lv.reference_target_1).toBe(102);
    expect(lv.reference_stop_level).toBeCloseTo(Math.round(Math.min(98, 99.5) * 0.998 * 10000) / 10000, 4);
  });

  test("deriveEvidenceInsightFallback uses (target-entry)/(entry-stop) not mid-range ratio", () => {
    const ev = buildEvidenceFromSetup(
      baseSetup,
      {
        symbol: "AAPL",
        last_trade_price: 100,
        prev_close: 99,
        day_low: 98,
        day_high: 102,
        day_vwap: 99.5
      },
      { symbolNewsArticles: [] }
    );
    const insight = deriveEvidenceInsightFallback(ev);
    expect(insight.reference_target_1).toBe(102);
    const stop = Math.min(98, 99.5) * 0.998;
    const rr = (102 - 100) / (100 - stop);
    expect(insight.risk_reward).toBe(Math.round(Math.min(10, Math.max(0.5, rr)) * 10) / 10);
    expect(insight.rr_warning).toBe(insight.risk_reward < 2.0);
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
      reference_stop_level: 99,
      day_vwap: 101.25
    });
    expect(insight).not.toBeNull();
    expect(insight!.signal_score).toBe(82);
    expect(insight!.risk_reward).toBe(2.3);
    expect(insight!.confirming_signals[0]?.label).toBe("ORB Breakout");
    expect(insight!.historical_entry_zone?.low).toBe(100);
    expect(insight!.vwap).toBe(101.25);
  });

  test("returns null when no scorable field present", () => {
    expect(parseSwingCompositeInsight({ trend_strength: "Weak" })).toBeNull();
  });

  test("derives signal_score from signal_strength when signal_score omitted", () => {
    const insight = parseSwingCompositeInsight({
      signal_strength: 0.82,
      trend_strength: "Strong",
      trend_direction: "Uptrend",
      risk_reward: 2.0,
      market_regime: "Bullish",
      catalysts: [],
      risk_factors: [],
      signal_parameters: "x"
    });
    expect(insight).not.toBeNull();
    expect(insight!.signal_score).toBe(82);
  });

  test("sets rr warning badge flag when below 2", () => {
    const insight = parseSwingCompositeInsight({ signal_score: 60, risk_reward: 1.7, market_regime: "Neutral" });
    expect(insight?.rr_warning).toBe(true);
  });

  test("parses catalyst headlines and structured risk factors", () => {
    const insight = parseSwingCompositeInsight({
      signal_score: 66,
      risk_reward: 2.2,
      market_regime: "Neutral",
      catalysts: [{ title: "Macro catalyst headline", source: "benzinga", sentiment_score: -0.62 }],
      risk_factors_detailed: [{ label: "Conflicted Signal", severity: "high", detail: "4/6 layers conflict" }]
    });
    expect(insight?.catalysts[0]?.text).toContain("Macro");
    expect(insight?.risk_factors_detailed?.[0]?.severity).toBe("high");
  });

  test("prefers catalyst_headlines when non-empty and preserves metadata", () => {
    const insight = parseSwingCompositeInsight({
      signal_score: 70,
      risk_reward: 2.0,
      market_regime: "Bullish",
      catalysts: [],
      catalyst_headlines: [
        {
          text: "Fed minutes spark rally",
          source: "polygon",
          published_at: "2026-01-10T15:00:00.000Z",
          sentiment_score: 0.85,
          sentiment: "positive"
        }
      ],
      risk_factors: [],
      signal_parameters: "x"
    });
    expect(insight?.catalysts).toHaveLength(1);
    expect(insight?.catalysts[0]?.text).toContain("Fed minutes");
    expect(insight?.catalysts[0]?.source).toBe("polygon");
    expect(insight?.catalysts[0]?.published_at).toBe("2026-01-10T15:00:00.000Z");
    expect(insight?.catalysts[0]?.sentiment).toBe("positive");
    expect(insight?.catalysts[0]?.sentiment_score).toBe(0.85);
  });

  test("merges catalyst_headlines first then extra catalyst rows up to limit", () => {
    const insight = parseSwingCompositeInsight({
      signal_score: 70,
      risk_reward: 2.0,
      market_regime: "Neutral",
      catalyst_headlines: [{ text: "Headline A", sentiment: "positive" }],
      catalysts: [{ text: "Headline B", sentiment: "negative" }],
      risk_factors: [],
      signal_parameters: "x"
    });
    expect(insight?.catalysts).toHaveLength(2);
    expect(insight?.catalysts[0]?.text).toBe("Headline A");
    expect(insight?.catalysts[1]?.text).toBe("Headline B");
  });

  test("uses catalysts when catalyst_headlines is empty array", () => {
    const insight = parseSwingCompositeInsight({
      signal_score: 70,
      risk_reward: 2.0,
      market_regime: "Neutral",
      catalysts: [{ text: "Earnings beat", sentiment: "positive" }],
      catalyst_headlines: [],
      risk_factors: [],
      signal_parameters: "x"
    });
    expect(insight?.catalysts[0]?.text).toBe("Earnings beat");
  });

  test("marks incomplete signal state from payload", () => {
    const insight = parseSwingCompositeInsight({
      signal_score: 55,
      risk_reward: 2.1,
      market_regime: "Neutral",
      is_complete: false,
      missing_fields: ["vwap"]
    });
    expect(insight?.is_complete).toBe(false);
    expect(insight?.missing_fields).toContain("vwap");
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

  test("replaces layer keyPoints from composite chips when layers array present", () => {
    const base = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const enriched = applySwingCompositeEnrichment(base, {
      signal_score: 71,
      trend_strength: "Moderate",
      trend_direction: "Uptrend",
      risk_reward: 2.1,
      market_regime: "Bullish",
      catalysts: [],
      risk_factors: [],
      signal_parameters: "",
      historical_entry_zone: { low: 10, high: 11 },
      layers: [
        { layer: "technical", chips: ["RSI 55", "VWAP Above"], reasoning: "" },
        { layer: "macro", chips: ["SPY +0.4%"], reasoning: "" }
      ]
    });
    const tech = enriched.layers.find((l) => l.key === "technical");
    const macro = enriched.layers.find((l) => l.key === "macro");
    expect(tech?.keyPoints[0]).toBe("RSI 55");
    expect(tech?.keyPoints[1]).toBe("VWAP Above");
    expect(macro?.keyPoints[0]).toBe("SPY +0.4%");
  });

  test("syncs layer badge and contribution score from API verdict (chips vs heuristic mismatch)", () => {
    const base = buildEvidenceFromSetup(
      { ...baseSetup, direction: "long", score: 0.85 },
      { symbol: "AAPL", last_trade_price: 200, prev_close: 198, day_vwap: 199 },
      { symbolNewsArticles: [] }
    );
    const techBefore = base.layers.find((l) => l.key === "technical");
    expect(techBefore?.status).toBe("Bullish");
    const enriched = applySwingCompositeEnrichment(base, {
      signal_score: 50,
      trend_strength: "Weak",
      trend_direction: "Sideways",
      risk_reward: 1.2,
      market_regime: "Neutral",
      catalysts: [],
      risk_factors: [],
      signal_parameters: "x",
      historical_entry_zone: { low: 10, high: 11 },
      layers: [
        {
          layer: "technical",
          chips: ["RSI 43", "VWAP Below", "EMA Stack Bearish"],
          verdict: "bearish",
          score: 32,
          status: "available",
          reasoning: ""
        }
      ]
    });
    const tech = enriched.layers.find((l) => l.key === "technical");
    expect(tech?.status).toBe("Bearish");
    expect(tech?.contributionScore).toBe(32);
    expect(tech?.keyPoints[0]).toBe("RSI 43");
  });

  test("maps unavailable layer with score to as-of-close state and keeps numeric score", () => {
    const base = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const enriched = applySwingCompositeEnrichment(base, {
      signal_score: 50,
      trend_strength: "Weak",
      trend_direction: "Sideways",
      risk_reward: 1.2,
      market_regime: "Neutral",
      catalysts: [],
      risk_factors: [],
      signal_parameters: "x",
      historical_entry_zone: { low: 10, high: 11 },
      layers: [
        {
          layer: "news",
          chips: ["No qualifying news articles in lookback"],
          verdict: "neutral",
          score: 42,
          status: "unavailable",
          reasoning: ""
        }
      ]
    });
    const news = enriched.layers.find((l) => l.key === "news");
    expect(news?.status).toBe("As of close");
    expect(news?.contributionScore).toBe(42);
    expect(news?.keyPoints[0]).toContain("No qualifying news");
  });

  test("keeps unavailable layer at zero when API does not provide a score", () => {
    const base = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const enriched = applySwingCompositeEnrichment(base, {
      signal_score: 50,
      trend_strength: "Weak",
      trend_direction: "Sideways",
      risk_reward: 1.2,
      market_regime: "Neutral",
      catalysts: [],
      risk_factors: [],
      signal_parameters: "x",
      historical_entry_zone: { low: 10, high: 11 },
      layers: [{ layer: "news", chips: ["No qualifying news articles in lookback"], status: "unavailable", reasoning: "" }]
    });
    const news = enriched.layers.find((l) => l.key === "news");
    expect(news?.status).toBe("Unavailable");
    expect(news?.contributionScore).toBe(0);
  });

  test("fills reference levels from client snapshot when composite omits them but signal_score present", () => {
    const base = buildEvidenceFromSetup(
      baseSetup,
      {
        symbol: "AAPL",
        last_trade_price: 100,
        prev_close: 99,
        day_low: 98,
        day_high: 102,
        day_vwap: 99.5
      },
      { symbolNewsArticles: [] }
    );
    const enriched = applySwingCompositeEnrichment(base, {
      signal_score: 71,
      trend_strength: "Moderate",
      trend_direction: "Uptrend",
      risk_reward: 2.1,
      market_regime: "Bullish",
      catalysts: [],
      risk_factors: ["A", "B", "C"],
      signal_parameters: "Server copy.",
      historical_entry_zone: null,
      reference_target_1: null,
      reference_target_2: null,
      reference_stop_level: null
    });
    expect(enriched.insight?.historical_entry_zone?.low).toBe(98);
    expect(enriched.insight?.historical_entry_zone?.high).toBe(102);
    expect(enriched.insight?.reference_target_1).not.toBeNull();
    expect(enriched.insight?.reference_stop_level).not.toBeNull();
    expect(enriched.insight?.vwap).toBe(99.5);
  });

  test("parses geopolitical layer extras from composite layers row", () => {
    const geo = extractGeopoliticalLayerExtras({
      layer: "geopolitical",
      geo_impact_sector_key: "semiconductors",
      geo_stock_exposure_score: 4.2,
      geo_exposure_band: "moderate",
      geo_exposure_summary: "Supply-chain and export controls weigh on fabs.",
      geo_active_events: [{ event_type: "trade_tension", score: 2 }],
      geo_event_details: [
        { event_type: "trade_tension", score: 2, sector_multiplier: 1.5 },
        { event_type: "sanctions", score: 1, sector_multiplier: 2 }
      ]
    });
    expect(geo).toBeDefined();
    expect(geo!.impactSectorLabel).toBe("Semiconductors");
    expect(geo!.stockExposureScore).toBe(4.2);
    expect(geo!.exposureBand).toBe("moderate");
    expect(geo!.exposureSummary).toContain("Supply-chain");
    expect(geo!.eventDetails).toHaveLength(2);
    expect(geo!.eventDetails[0].sector_multiplier).toBe(1.5);
  });

  test("merges geo onto geopolitical evidence layer when composite provides layers[]", () => {
    const base = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const enriched = applySwingCompositeEnrichment(base, {
      signal_score: 70,
      trend_strength: "Moderate",
      trend_direction: "Uptrend",
      risk_reward: 2,
      market_regime: "Bullish",
      catalysts: [],
      risk_factors: [],
      signal_parameters: "x",
      historical_entry_zone: { low: 10, high: 11 },
      layers: [
        {
          layer: "geopolitical",
          chips: ["Themes: trade_tension", "Sector map: semiconductors"],
          verdict: "bearish",
          score: 40,
          status: "available",
          reasoning: "",
          geo_impact_sector_key: "technology_hardware",
          geo_stock_exposure_score: 3.1,
          geo_exposure_band: "low",
          geo_exposure_summary: "Limited direct exposure.",
          geo_event_details: [{ event_type: "trade_tension", score: 1, sector_multiplier: 1.2 }]
        }
      ]
    });
    const geoLayer = enriched.layers.find((l) => l.key === "geopolitical");
    expect(geoLayer?.geo?.impactSectorLabel).toBe("Technology Hardware");
    expect(geoLayer?.geo?.stockExposureScore).toBe(3.1);
    expect(geoLayer?.keyPoints[0]).toContain("Themes");
  });
});

describe("SignalEvidenceCard geopolitical panel", () => {
  test("renders band, sector, themes, and summary in static markup", () => {
    const base = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const enriched = applySwingCompositeEnrichment(base, {
      signal_score: 70,
      trend_strength: "Moderate",
      trend_direction: "Uptrend",
      risk_reward: 2,
      market_regime: "Bullish",
      catalysts: [],
      risk_factors: [],
      signal_parameters: "x",
      historical_entry_zone: { low: 10, high: 11 },
      layers: [
        {
          layer: "geopolitical",
          chips: ["Themes: trade_tension"],
          verdict: "bearish",
          score: 40,
          status: "available",
          reasoning: "",
          geo_impact_sector_key: "semiconductors",
          geo_stock_exposure_score: 3.1,
          geo_exposure_band: "moderate",
          geo_exposure_summary: "Tariff headlines skew risk for fabs.",
          geo_event_details: [{ event_type: "trade_tension", score: 1.5, sector_multiplier: 1.2 }]
        }
      ]
    });
    const html = renderToStaticMarkup(
      createElement(ThemeProvider, null, createElement(SignalEvidenceCard, { evidence: enriched }))
    );
    expect(html).toContain("Stock geo exposure");
    expect(html).toContain("Semiconductors");
    expect(html).toContain("moderate");
    expect(html).toContain("Trade Tension");
    expect(html).toContain("Tariff headlines");
  });
});
