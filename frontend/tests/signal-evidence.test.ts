import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { SignalEvidenceCard } from "@/components/signal-evidence-card";
import { ThemeProvider } from "@/lib/theme-provider";
import { UserProfileProvider } from "@/lib/user-profile-context";
import {
  applySwingCompositeEnrichment,
  buildEvidenceFromSetup,
  deriveEvidenceInsightFallback,
  extractGeopoliticalLayerExtras,
  filterChipsForMode,
  parseCompositeAlignment,
  parseSwingCompositeInsight,
  referenceLevelsFromSessionStructure,
  sanitizeEvidenceChips,
  getVWAPDisplay
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

describe("parseCompositeAlignment", () => {
  test("parses backend alignment payload", () => {
    const a = parseCompositeAlignment({
      level: "full",
      score_modifier: 14,
      label: "Full alignment",
      detail: "All layers confirm.",
      chip: "All layers aligned ✓",
      is_tailwind: true,
      is_headwind: false,
      is_counter_trend: false,
      macro_direction: "bullish",
      sector_direction: "bullish",
      technical_direction: "bullish",
      macro_supports: true,
      sector_supports: true,
      technical_supports: true
    });
    expect(a).not.toBeNull();
    expect(a!.level).toBe("full");
    expect(a!.score_modifier).toBe(14);
    expect(a!.macro_supports).toBe(true);
  });

  test("returns null on invalid level", () => {
    expect(
      parseCompositeAlignment({
        level: "nope",
        score_modifier: 1,
        label: "x",
        detail: "y",
        chip: "z"
      })
    ).toBeNull();
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

  test("merges alignment and sector momentum extras from composite body", () => {
    const base = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const enriched = applySwingCompositeEnrichment(base, {
      mode: "swing",
      signal_score: 70,
      trend_strength: "Moderate",
      trend_direction: "Uptrend",
      risk_reward: 2,
      market_regime: "Bullish",
      catalysts: [],
      risk_factors: [],
      signal_parameters: "x",
      historical_entry_zone: { low: 10, high: 11 },
      alignment: {
        level: "strong",
        score_modifier: 8,
        label: "Strong alignment",
        detail: "Macro and sector support.",
        chip: "Macro + sector ✓",
        is_tailwind: true,
        is_headwind: false,
        is_counter_trend: false,
        macro_direction: "bullish",
        sector_direction: "bullish",
        technical_direction: "neutral",
        macro_supports: true,
        sector_supports: true,
        technical_supports: false
      },
      layers: [
        {
          layer: "sector",
          chips: ["XLK +0.3% vs SPY"],
          verdict: "bullish",
          score: 62,
          status: "available",
          reasoning: "",
          sector_resolution_state: "resolved",
          sector_persistence: 0.8,
          sector_sessions_leading: 4,
          sector_total_sessions: 5,
          sector_trending: "strengthening",
          sector_rank_1d: 0.71,
          sector_rank_5d: 0.65,
          sector_interpretation: "Semi leadership",
          sector_data_available: true,
          sector_daily_sessions: [
            { date: "2026-01-06", etf_pct: 1.2, spy_pct: 0.5, relative: 0.7, outperformed: true, volume_ratio: 1 }
          ]
        }
      ]
    });
    expect(enriched.alignment?.level).toBe("strong");
    expect(enriched.alignment?.score_modifier).toBe(8);
    const sec = enriched.layers.find((l) => l.key === "sector");
    expect(sec?.sector_resolution_state).toBe("resolved");
    expect(sec?.sector_persistence).toBe(0.8);
    expect(sec?.sector_interpretation).toBe("Semi leadership");
    expect(sec?.sector_daily_sessions).toHaveLength(1);
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
          geo_has_live_events: true,
          geo_active_events: [{ event_type: "trade_tension", score: 1.5 }],
          geo_event_details: [{ event_type: "trade_tension", score: 1.5, sector_multiplier: 1.2 }]
        }
      ]
    });
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(
          UserProfileProvider,
          { value: { profile: null, loaded: true } },
          createElement(SignalEvidenceCard, { evidence: enriched })
        )
      )
    );
    expect(html).toContain("Stock geo exposure");
    expect(html).toContain("Semiconductors");
    expect(html).toContain("moderate");
    expect(html).toContain("Trade Tension");
    expect(html).toContain("Tariff headlines");
  });
});

describe("SignalEvidenceCard sector + cross-layer alignment", () => {
  test("renders alignment chip and sector momentum details", () => {
    const base = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const enriched = applySwingCompositeEnrichment(base, {
      mode: "swing",
      signal_score: 70,
      trend_strength: "Moderate",
      trend_direction: "Uptrend",
      risk_reward: 2,
      market_regime: "Bullish",
      catalysts: [],
      risk_factors: [],
      signal_parameters: "x",
      historical_entry_zone: { low: 10, high: 11 },
      reference_target_1: 12,
      reference_stop_level: 9,
      reference_target_2: 13,
      alignment: {
        level: "moderate",
        score_modifier: 4,
        label: "Moderate alignment",
        detail: "Some confirmation across layers.",
        chip: "Mixed but constructive",
        is_tailwind: false,
        is_headwind: false,
        is_counter_trend: false,
        macro_direction: "bullish",
        sector_direction: "bullish",
        technical_direction: "bearish",
        macro_supports: true,
        sector_supports: true,
        technical_supports: false
      },
      layers: [
        {
          layer: "sector",
          chips: ["XLK vs SPY"],
          verdict: "bullish",
          score: 58,
          status: "available",
          reasoning: "",
          sector_resolution_state: "resolved",
          sector_persistence: 0.6,
          sector_sessions_leading: 3,
          sector_total_sessions: 5,
          sector_interpretation: "Tech bid",
          sector_data_available: true
        }
      ]
    });
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(
          UserProfileProvider,
          { value: { profile: null, loaded: true } },
          createElement(SignalEvidenceCard, { evidence: enriched })
        )
      )
    );
    expect(html).toContain("LAYER ALIGNMENT");
    expect(html).toContain("Mixed but constructive");
    expect(html).toContain("Tech bid");
    expect(html).toContain("Resolved");
  });
});

describe("ORB technical chips (evidence)", () => {
  test("sanitizeEvidenceChips removes expired and keeps RSI", () => {
    expect(sanitizeEvidenceChips(["ORB Expired", "RSI 47"])).toEqual(["RSI 47"]);
  });

  test("expired ORB chip filtered from layer keyPoints in static markup", () => {
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
          layer: "technical",
          chips: ["ORB Expired", "RSI 47"],
          verdict: "neutral",
          score: 55,
          status: "available",
          reasoning: ""
        }
      ]
    });
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(
          UserProfileProvider,
          { value: { profile: null, loaded: true } },
          createElement(SignalEvidenceCard, { evidence: enriched })
        )
      )
    );
    expect(html).toContain("RSI 47");
    expect(html).not.toContain("ORB Expired");
  });

  test("ORB Long chip uses green ORB styling", () => {
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
          layer: "technical",
          chips: ["ORB Long ↑ $432.15"],
          verdict: "bullish",
          score: 62,
          status: "available",
          reasoning: ""
        }
      ]
    });
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(
          UserProfileProvider,
          { value: { profile: null, loaded: true } },
          createElement(SignalEvidenceCard, { evidence: enriched })
        )
      )
    );
    expect(html).toContain("ORB Long");
    expect(html).toContain("rgba(34,197,94");
  });

  test("ORB Short chip uses red ORB styling", () => {
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
          layer: "technical",
          chips: ["ORB Short ↓ $428.90"],
          verdict: "bearish",
          score: 40,
          status: "available",
          reasoning: ""
        }
      ]
    });
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(
          UserProfileProvider,
          { value: { profile: null, loaded: true } },
          createElement(SignalEvidenceCard, { evidence: enriched })
        )
      )
    );
    expect(html).toContain("ORB Short");
    expect(html).toContain("rgba(239,68,68");
  });

  test("ORB Forming chip uses amber ORB styling", () => {
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
          layer: "technical",
          chips: ["ORB Forming"],
          verdict: "neutral",
          score: 50,
          status: "available",
          reasoning: ""
        }
      ]
    });
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(
          UserProfileProvider,
          { value: { profile: null, loaded: true } },
          createElement(SignalEvidenceCard, { evidence: enriched })
        )
      )
    );
    expect(html).toContain("ORB Forming");
    expect(html).toContain("rgba(245,158,11");
  });
});

describe("VWAP evidence display", () => {
  test("getVWAPDisplay uses server vwap_display when provided", () => {
    const d = getVWAPDisplay(null, "pre_market", null, "VWAP starts at 9:30 ET", "Server tip");
    expect(d.label).toBe("VWAP starts at 9:30 ET");
    expect(d.muted).toBe(true);
    expect(d.tooltip).toBe("Server tip");
  });

  test("vwap reference row never shows bare em dash placeholder", () => {
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
      vwap_state: "pre_market",
      vwap_display: "VWAP starts at 9:30 ET",
      vwap_tooltip: "Pre-market copy.",
      reference_target_1: 12,
      reference_stop_level: 9,
      reference_target_2: 13
    });
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(
          UserProfileProvider,
          { value: { profile: null, loaded: true } },
          createElement(SignalEvidenceCard, { evidence: enriched })
        )
      )
    );
    expect(html).toContain("VWAP starts at 9:30 ET");
    expect(html).not.toContain("VWAP: </strong>—");
  });

  test("vwap post_market uses muted class on value", () => {
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
      vwap_state: "post_market",
      vwap_display: "VWAP (RTH closed)",
      vwap_tooltip: "RTH only.",
      reference_target_1: 12,
      reference_stop_level: 9,
      reference_target_2: 13
    });
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(
          UserProfileProvider,
          { value: { profile: null, loaded: true } },
          createElement(SignalEvidenceCard, { evidence: enriched })
        )
      )
    );
    expect(html).toContain("text-muted-foreground");
    expect(html).toContain("VWAP (RTH closed)");
  });

  test("vwap available shows price without muted class", () => {
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
      vwap_state: "available",
      vwap_display: "VWAP $430.21 — Above",
      vwap_tooltip: "Anchor.",
      vwap: 430.21,
      reference_target_1: 12,
      reference_stop_level: 9,
      reference_target_2: 13
    });
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(
          UserProfileProvider,
          { value: { profile: null, loaded: true } },
          createElement(SignalEvidenceCard, { evidence: enriched })
        )
      )
    );
    expect(html).toContain("$430.21");
    const idx = html.indexOf("VWAP $430.21");
    expect(idx).toBeGreaterThan(-1);
    const slice = html.slice(Math.max(0, idx - 80), idx + 40);
    expect(slice).not.toContain("text-muted-foreground");
  });

  test("VWAP above chip is green tinted", () => {
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
          layer: "technical",
          chips: ["VWAP $430.21 — Above"],
          verdict: "bullish",
          score: 62,
          status: "available",
          reasoning: ""
        }
      ]
    });
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(
          UserProfileProvider,
          { value: { profile: null, loaded: true } },
          createElement(SignalEvidenceCard, { evidence: enriched })
        )
      )
    );
    expect(html).toContain("rgba(34,197,94");
  });

  test("VWAP below chip is red tinted", () => {
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
          layer: "technical",
          chips: ["VWAP $430.21 — Below"],
          verdict: "bearish",
          score: 40,
          status: "available",
          reasoning: ""
        }
      ]
    });
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(
          UserProfileProvider,
          { value: { profile: null, loaded: true } },
          createElement(SignalEvidenceCard, { evidence: enriched })
        )
      )
    );
    expect(html).toContain("rgba(239,68,68");
  });

  test("VWAP Forming chip is amber", () => {
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
          layer: "technical",
          chips: ["VWAP Forming"],
          verdict: "neutral",
          score: 50,
          status: "available",
          reasoning: ""
        }
      ]
    });
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(
          UserProfileProvider,
          { value: { profile: null, loaded: true } },
          createElement(SignalEvidenceCard, { evidence: enriched })
        )
      )
    );
    expect(html).toContain("rgba(245,158,11");
  });

  test("VWAP row renders InfoTip", () => {
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
      vwap_state: "available",
      vwap_display: "VWAP $100.00 — Above",
      vwap_tooltip: "Tooltip body not empty.",
      vwap: 100,
      reference_target_1: 12,
      reference_stop_level: 9,
      reference_target_2: 13
    });
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(
          UserProfileProvider,
          { value: { profile: null, loaded: true } },
          createElement(SignalEvidenceCard, { evidence: enriched })
        )
      )
    );
    expect(html).toContain("VWAP context");
  });
});

describe("Indicator scope (swing vs day chips)", () => {
  test("filterChipsForMode strips intraday chips for swing", () => {
    const out = filterChipsForMode(["VWAP Below", "RSI 47 (Daily)", "EMA9 bounce (session)"], "swing");
    expect(out).toEqual(["RSI 47 (Daily)"]);
  });

  test("swing card shows derived-from-daily-bars label", () => {
    const base = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const enriched = applySwingCompositeEnrichment(base, {
      mode: "swing",
      signal_basis: "daily_bars_rth",
      signal_basis_label: "Derived from daily bars (RTH)",
      signal_score: 70,
      trend_strength: "Moderate",
      trend_direction: "Uptrend",
      risk_reward: 2,
      market_regime: "Bullish",
      catalysts: [],
      risk_factors: [],
      signal_parameters: "x",
      historical_entry_zone: { low: 10, high: 11 },
      reference_target_1: 12,
      reference_stop_level: 9,
      reference_target_2: 13,
      layers: [
        {
          layer: "technical",
          chips: ["RSI 55 (Daily)"],
          verdict: "bullish",
          score: 60,
          status: "available",
          reasoning: ""
        }
      ]
    });
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(
          UserProfileProvider,
          { value: { profile: null, loaded: true } },
          createElement(SignalEvidenceCard, { evidence: enriched })
        )
      )
    );
    expect(html).toContain("Derived from daily bars (RTH)");
  });

  test("day card keeps VWAP chip text", () => {
    const base = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const enriched = applySwingCompositeEnrichment(base, {
      mode: "day",
      signal_score: 70,
      trend_strength: "Moderate",
      trend_direction: "Uptrend",
      risk_reward: 2,
      market_regime: "Bullish",
      catalysts: [],
      risk_factors: [],
      signal_parameters: "x",
      historical_entry_zone: { low: 10, high: 11 },
      reference_target_1: 12,
      reference_stop_level: 9,
      reference_target_2: 13,
      layers: [
        {
          layer: "technical",
          chips: ["VWAP $430.21 — Below"],
          verdict: "bearish",
          score: 40,
          status: "available",
          reasoning: ""
        }
      ]
    });
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(
          UserProfileProvider,
          { value: { profile: null, loaded: true } },
          createElement(SignalEvidenceCard, { evidence: enriched })
        )
      )
    );
    expect(html).toContain("VWAP $430.21");
  });

  test("bare EMA9 chip not rendered on swing technical row", () => {
    const base = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const enriched = applySwingCompositeEnrichment(base, {
      mode: "swing",
      signal_basis: "daily_bars_rth",
      signal_score: 70,
      trend_strength: "Moderate",
      trend_direction: "Uptrend",
      risk_reward: 2,
      market_regime: "Bullish",
      catalysts: [],
      risk_factors: [],
      signal_parameters: "x",
      historical_entry_zone: { low: 10, high: 11 },
      reference_target_1: 12,
      reference_stop_level: 9,
      reference_target_2: 13,
      layers: [
        {
          layer: "technical",
          chips: ["EMA9 Bounce", "RSI 62 (Daily)"],
          verdict: "bullish",
          score: 60,
          status: "available",
          reasoning: ""
        }
      ]
    });
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(
          UserProfileProvider,
          { value: { profile: null, loaded: true } },
          createElement(SignalEvidenceCard, { evidence: enriched })
        )
      )
    );
    expect(html).not.toContain("EMA9 Bounce</span>");
    expect(html).toContain("RSI 62 (Daily)");
  });

  test("EMA9 (Daily) chip renders on swing", () => {
    const base = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const enriched = applySwingCompositeEnrichment(base, {
      mode: "swing",
      signal_score: 70,
      trend_strength: "Moderate",
      trend_direction: "Uptrend",
      risk_reward: 2,
      market_regime: "Bullish",
      catalysts: [],
      risk_factors: [],
      signal_parameters: "x",
      historical_entry_zone: { low: 10, high: 11 },
      reference_target_1: 12,
      reference_stop_level: 9,
      reference_target_2: 13,
      layers: [
        {
          layer: "technical",
          chips: ["EMA9 Bounce (Daily)"],
          verdict: "bullish",
          score: 60,
          status: "available",
          reasoning: ""
        }
      ]
    });
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(
          UserProfileProvider,
          { value: { profile: null, loaded: true } },
          createElement(SignalEvidenceCard, { evidence: enriched })
        )
      )
    );
    expect(html).toContain("EMA9 Bounce (Daily)");
  });
});

describe("Macro layer warning surface", () => {
  function renderMacroEvidence(body: Record<string, unknown>): string {
    const base = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const enriched = applySwingCompositeEnrichment(base, body);
    return renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(
          UserProfileProvider,
          { value: { profile: null, loaded: true } },
          createElement(SignalEvidenceCard, { evidence: enriched })
        )
      )
    );
  }

  test("critical banner shown when imminent", () => {
    const html = renderMacroEvidence({
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
          layer: "macro",
          verdict: "neutral",
          score: 55,
          status: "available",
          reasoning: "Macro",
          macro_risk_level: "critical",
          macro_warnings: ["⚠️ FOMC in 45 minutes"],
          upcoming_events: [],
          yield_curve: null
        }
      ]
    });
    expect(html).toContain("High-Impact Event Imminent");
    expect(html).toContain("⚠️ FOMC in 45 minutes");
  });

  test("no banner when low risk", () => {
    const html = renderMacroEvidence({
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
          layer: "macro",
          verdict: "neutral",
          score: 55,
          status: "available",
          reasoning: "Macro",
          macro_risk_level: "low",
          macro_warnings: [],
          upcoming_events: [],
          yield_curve: null
        }
      ]
    });
    expect(html).not.toContain("High-Impact Event Imminent");
    expect(html).not.toContain("Macro Event Today");
  });

  test("yield curve inverted shows red", () => {
    const html = renderMacroEvidence({
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
          layer: "macro",
          verdict: "neutral",
          score: 55,
          status: "available",
          reasoning: "Macro",
          macro_risk_level: "low",
          macro_warnings: [],
          upcoming_events: [],
          yield_curve: {
            yield_2yr: 4.2,
            yield_10yr: 3.8,
            spread: -0.4,
            regime: "inverted",
            label: "Yield curve: inverted ⚠️",
            chip: "2s10s: -0.40% (inverted)"
          }
        }
      ]
    });
    expect(html).toContain("text-red-400");
    expect(html).toContain("Yield curve:");
  });

  test("yield curve normal shows green", () => {
    const html = renderMacroEvidence({
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
          layer: "macro",
          verdict: "neutral",
          score: 55,
          status: "available",
          reasoning: "Macro",
          macro_risk_level: "low",
          macro_warnings: [],
          upcoming_events: [],
          yield_curve: {
            yield_2yr: 3.8,
            yield_10yr: 4.5,
            spread: 0.7,
            regime: "normal",
            label: "Yield curve: normal",
            chip: "2s10s: +0.70%"
          }
        }
      ]
    });
    expect(html).toContain("text-green-400");
  });

  test("upcoming events listed", () => {
    const html = renderMacroEvidence({
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
          layer: "macro",
          verdict: "neutral",
          score: 55,
          status: "available",
          reasoning: "Macro",
          macro_risk_level: "moderate",
          macro_warnings: [],
          upcoming_events: [
            {
              event_id: "1",
              name: "Alpha Release",
              category: "CPI",
              status: "upcoming",
              importance: 5,
              hours_until: 72,
              warning: null,
              scheduled_time: "2026-05-10T08:30:00-04:00"
            },
            {
              event_id: "2",
              name: "Bravo Jobs",
              category: "Jobs",
              status: "upcoming",
              importance: 5,
              hours_until: 48,
              warning: null,
              scheduled_time: "2026-05-09T08:30:00-04:00"
            },
            {
              event_id: "3",
              name: "Charlie GDP",
              category: "GDP",
              status: "upcoming",
              importance: 4,
              hours_until: 96,
              warning: null,
              scheduled_time: "2026-05-11T08:30:00-04:00"
            }
          ],
          yield_curve: null
        }
      ]
    });
    expect(html).toContain("Alpha Release");
    expect(html).toContain("Bravo Jobs");
    expect(html).toContain("Charlie GDP");
  });

  test("imminent event shows minutes", () => {
    const html = renderMacroEvidence({
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
          layer: "macro",
          verdict: "neutral",
          score: 55,
          status: "available",
          reasoning: "Macro",
          macro_risk_level: "low",
          macro_warnings: [],
          upcoming_events: [
            {
              event_id: "x",
              name: "FOMC",
              category: "Fed",
              status: "imminent",
              importance: 5,
              hours_until: 0.75,
              warning: null,
              scheduled_time: "2026-05-07T14:00:00-04:00"
            }
          ],
          yield_curve: null
        }
      ]
    });
    expect(html).toContain("45m");
  });
});
