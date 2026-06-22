import { describe, expect, test } from "vitest";

import { compositeToSignalsLayerRows } from "@/lib/signals/composite-layer-rows";

describe("compositeToSignalsLayerRows", () => {
  test("maps unavailable technical without score to null not zero", () => {
    const rows = compositeToSignalsLayerRows({
      layers: [
        {
          layer: "technical",
          status: "unavailable",
          score: null,
          verdict: "neutral",
          reasoning: "Insufficient bar data. Market may be closed."
        }
      ]
    });
    const tech = rows.find((r) => r.key === "technical");
    expect(tech?.score).toBeNull();
    expect(tech?.status).toBe("As of close");
  });

  test("maps as_of_close API status with verdict and label", () => {
    const rows = compositeToSignalsLayerRows({
      layers: [
        {
          layer: "technical",
          status: "as_of_close",
          score: 58,
          verdict: "bullish",
          reasoning: "As of last close (daily structure — intraday VWAP/ORB not active until the regular session)."
        }
      ]
    });
    const tech = rows.find((r) => r.key === "technical");
    expect(tech?.status).toBe("Bullish");
    expect(tech?.statusLabel).toMatch(/As of close/i);
    expect(tech?.score).toBe(58);
  });

  test("threads per-layer verdict band (bullish/bearish thresholds)", () => {
    const rows = compositeToSignalsLayerRows({
      layers: [
        {
          layer: "sector",
          status: "available",
          score: 62,
          verdict: "neutral",
          bullish_threshold: 65,
          bearish_threshold: 35
        },
        {
          layer: "geopolitical",
          status: "available",
          score: 58,
          verdict: "neutral",
          bullish_threshold: 60,
          bearish_threshold: 35
        }
      ]
    });
    const sector = rows.find((r) => r.key === "sector");
    expect(sector?.bullishThreshold).toBe(65);
    expect(sector?.bearishThreshold).toBe(35);
    const geo = rows.find((r) => r.key === "geopolitical");
    expect(geo?.bullishThreshold).toBe(60);
    expect(geo?.bearishThreshold).toBe(35);
  });

  test("verdict band is null when the API omits thresholds", () => {
    const rows = compositeToSignalsLayerRows({
      layers: [{ layer: "macro", status: "available", score: 46, verdict: "neutral" }]
    });
    const macro = rows.find((r) => r.key === "macro");
    expect(macro?.bullishThreshold ?? null).toBeNull();
    expect(macro?.bearishThreshold ?? null).toBeNull();
  });

  test("sector row shows benchmark label when resolved", () => {
    const rows = compositeToSignalsLayerRows({
      layers: [
        {
          layer: "sector",
          status: "available",
          score: 62,
          verdict: "bullish",
          sector_etf: "ITA",
          sector_display_name: "Aerospace & Defense",
          sector_resolution_state: "resolved"
        }
      ]
    });
    const sector = rows.find((r) => r.key === "sector");
    expect(sector?.statusLabel).toBe("Aerospace & Defense (ITA)");
  });

  test("sector row shows benchmark while cache resolves", () => {
    const rows = compositeToSignalsLayerRows({
      layers: [
        {
          layer: "sector",
          status: "unavailable",
          score: null,
          verdict: "neutral",
          sector_display_name: "Aerospace & Defense",
          sector_etf: "ITA",
          sector_resolution_state: "pending_cache_refresh"
        }
      ]
    });
    const sector = rows.find((r) => r.key === "sector");
    expect(sector?.statusLabel).toBe("Aerospace & Defense (ITA) · resolving");
    expect(sector?.sectorCachePending).toBe(true);
  });

  test("internals row uses Market Internals display name", () => {
    const rows = compositeToSignalsLayerRows({
      layers: [
        {
          layer: "internals",
          status: "available",
          score: 72,
          verdict: "bullish",
          reasoning: "Breadth supportive."
        }
      ]
    });
    const internals = rows.find((r) => r.key === "internals");
    expect(internals?.name).toBe("Market Internals");
  });

  test("maps reasoning to both explanation and reasoning fields", () => {
    const rows = compositeToSignalsLayerRows({
      layers: [
        {
          layer: "technical",
          status: "available",
          score: 72,
          verdict: "bullish",
          reasoning: "Price above VWAP with rising volume."
        }
      ]
    });
    const tech = rows.find((r) => r.key === "technical");
    expect(tech?.explanation).toBe("Price above VWAP with rising volume.");
    expect(tech?.reasoning).toBe("Price above VWAP with rising volume.");
  });

  test("maps technical chips and vwap metadata", () => {
    const rows = compositeToSignalsLayerRows({
      layers: [
        {
          layer: "technical",
          status: "available",
          score: 68,
          verdict: "bullish",
          reasoning: "Above VWAP",
          chips: ["Above VWAP", "RSI 58"],
          vwap_state: "Above VWAP"
        }
      ]
    });
    const tech = rows.find((r) => r.key === "technical");
    expect(tech?.chips).toEqual(["Above VWAP", "RSI 58"]);
    expect(tech?.vwapState).toBe("Above VWAP");
  });

  test("prefers quality_articles on the news layer over catalyst_headlines", () => {
    const rows = compositeToSignalsLayerRows({
      catalyst_headlines: [{ text: "Fallback headline", sentiment: "positive" }],
      layers: [
        {
          layer: "news",
          status: "available",
          score: 100,
          verdict: "bullish",
          article_count: 2,
          quality_articles: [
            {
              text: "Navan beats earnings",
              source: "polygon",
              published_at: "2026-06-10T12:00:00Z",
              sentiment: "positive"
            },
            {
              text: "Sector outlook stable",
              source: "benzinga",
              published_at: "2026-06-10T10:00:00Z",
              sentiment: "neutral"
            }
          ]
        }
      ]
    });
    const news = rows.find((r) => r.key === "news");
    expect(news?.catalystArticles?.map((a) => a.text)).toEqual([
      "Navan beats earnings",
      "Sector outlook stable"
    ]);
  });

  test("maps technical indicator snapshot and analyst recent ratings", () => {
    const rows = compositeToSignalsLayerRows({
      layers: [
        {
          layer: "technical",
          status: "available",
          score: 65,
          verdict: "bullish",
          indicator_snapshot: { mode: "day", rsi: 58, ema9: 12.5, volume_vs_adv: 1.2 }
        },
        {
          layer: "news",
          status: "available",
          score: 80,
          verdict: "bullish",
          recent_ratings: [
            {
              action: "Upgrade",
              rating: "Buy",
              firm: "Morgan Stanley",
              date: "2026-06-08",
              price_target: 24
            }
          ]
        }
      ]
    });
    expect(rows.find((r) => r.key === "technical")?.indicatorSnapshot?.rsi).toBe(58);
    expect(rows.find((r) => r.key === "news")?.recentRatings?.[0]?.firm).toBe("Morgan Stanley");
  });

  test("attaches catalyst headlines to the news row", () => {
    const rows = compositeToSignalsLayerRows({
      catalyst_headlines: [
        {
          text: "Navan raises guidance",
          source: "polygon",
          published_at: "2026-06-10T12:00:00Z",
          sentiment: "positive",
          url: "https://example.com/navan"
        }
      ],
      layers: [
        {
          layer: "news",
          status: "available",
          score: 100,
          verdict: "bullish",
          article_count: 2,
          reasoning: "News score 100/100 from 2 quality articles."
        }
      ]
    });
    const news = rows.find((r) => r.key === "news");
    expect(news?.articleCount).toBe(2);
    expect(news?.catalystArticles).toHaveLength(1);
    expect(news?.catalystArticles?.[0]?.text).toContain("Navan");
  });

  test("maps internals breadth and participation signals", () => {
    const rows = compositeToSignalsLayerRows({
      layers: [
        {
          layer: "internals",
          status: "available",
          score: 72,
          verdict: "bullish",
          breadth_signal: "strong_up",
          participation: "broad_up"
        }
      ]
    });
    const internals = rows.find((r) => r.key === "internals");
    expect(internals?.breadthSignal).toBe("strong_up");
    expect(internals?.participationSignal).toBe("broad_up");
  });

  test("threads news_geo_sensitivity onto news and geopolitical rows", () => {
    const rows = compositeToSignalsLayerRows({
      news_geo_sensitivity: {
        sic_bucket: "utilities",
        news: { band: "low", multiplier: 0.6 },
        geopolitical: { band: "high", multiplier: 1.0 }
      },
      layers: [
        { layer: "news", status: "available", score: 50, verdict: "neutral" },
        { layer: "geopolitical", status: "available", score: 50, verdict: "neutral" }
      ]
    });
    const news = rows.find((r) => r.key === "news");
    const geo = rows.find((r) => r.key === "geopolitical");
    expect(news?.sensitivityBand).toBe("low");
    expect(news?.sensitivityMultiplier).toBe(0.6);
    expect(geo?.sensitivityBand).toBe("high");
    expect(geo?.sensitivityMultiplier).toBe(1.0);
  });

  test("omits sensitivity fields when news_geo_sensitivity absent", () => {
    const rows = compositeToSignalsLayerRows({
      layers: [{ layer: "news", status: "available", score: 50, verdict: "neutral" }]
    });
    const news = rows.find((r) => r.key === "news");
    expect(news?.sensitivityBand).toBeUndefined();
    expect(news?.sensitivityMultiplier).toBeUndefined();
  });

  test("threads sector_technical_calibration onto the technical row", () => {
    const rows = compositeToSignalsLayerRows({
      sector_technical_calibration: {
        sic_bucket: "semiconductors",
        regime: "high_beta",
        rvol_threshold_multiplier: 1.2,
        overbought_penalty_multiplier: 0.7
      },
      layers: [{ layer: "technical", status: "available", score: 60, verdict: "bullish" }]
    });
    const tech = rows.find((r) => r.key === "technical");
    expect(tech?.techVolRegime).toBe("high_beta");
    expect(tech?.techRvolMultiplier).toBe(1.2);
    expect(tech?.techOverboughtMultiplier).toBe(0.7);
  });

  test("omits sector calibration fields when sector_technical_calibration absent", () => {
    const rows = compositeToSignalsLayerRows({
      layers: [{ layer: "technical", status: "available", score: 60, verdict: "bullish" }]
    });
    const tech = rows.find((r) => r.key === "technical");
    expect(tech?.techVolRegime).toBeUndefined();
    expect(tech?.techRvolMultiplier).toBeUndefined();
    expect(tech?.techOverboughtMultiplier).toBeUndefined();
  });

  test("preserves legitimate technical score of zero", () => {
    const rows = compositeToSignalsLayerRows({
      layers: [
        {
          layer: "technical",
          status: "available",
          score: 0,
          verdict: "bearish",
          reasoning: "Strong bearish stack"
        }
      ]
    });
    const tech = rows.find((r) => r.key === "technical");
    expect(tech?.score).toBe(0);
    expect(tech?.status).toBe("Bearish");
  });
});
