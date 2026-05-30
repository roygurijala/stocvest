import { describe, expect, test } from "vitest";
import { buildEvidenceFromSetup } from "@/lib/signal-evidence";
import { applySwingCompositeEnrichment } from "@/lib/signal-evidence";
import {
  evidenceLayerDisplayExplanation,
  evidenceLayerPlainEnglishExplanation,
  filterInternalLayerScoreCopy,
  layerCopyLooksInternal
} from "@/lib/signal-evidence/layer-plain-english";
import type { IntradaySetupPayload } from "@/lib/api/scanner";

const baseSetup: IntradaySetupPayload = {
  symbol: "SNOW",
  direction: "long",
  score: 0.7,
  triggers: ["test"],
  timestamp_iso: new Date().toISOString()
};

describe("layer-plain-english", () => {
  test("detects internal score copy", () => {
    expect(layerCopyLooksInternal("News score 92/100 from 2 quality articles")).toBe(true);
    expect(layerCopyLooksInternal("Macro 43/100 — momentum 33")).toBe(true);
    expect(layerCopyLooksInternal("Internals 60/100 — VIX component 50")).toBe(true);
    expect(layerCopyLooksInternal("VIX: Lower (18.2)")).toBe(false);
  });

  test("plain English news/macro/internals omit numeric scores", () => {
    const news = evidenceLayerPlainEnglishExplanation({
      key: "news",
      icon: "📰",
      name: "News",
      status: "Bullish",
      weightPercent: 10,
      explanation: "ignored",
      keyPoints: [],
      articles_count: 2
    });
    expect(news).not.toMatch(/\/100/);
    expect(news).toContain("2 recent articles");
    expect(news).toContain("bullish");

    const macro = evidenceLayerPlainEnglishExplanation({
      key: "macro",
      icon: "🌐",
      name: "Macro",
      status: "Neutral",
      weightPercent: 10,
      explanation: "ignored",
      keyPoints: [],
      macro_risk_level: "moderate"
    });
    expect(macro).not.toMatch(/\/100/);
    expect(macro).toContain("moderate");
  });

  test("composite enrichment strips reasoning score line from news keyPoints", () => {
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
      layers: [
        {
          layer: "news",
          verdict: "bullish",
          score: 92,
          status: "available",
          reasoning:
            "News score 92/100 from 2 quality articles (blended sentiment +0.83; headline +1.00, analyst +0.17)."
        },
        {
          layer: "macro",
          verdict: "neutral",
          score: 43,
          status: "available",
          reasoning: "Macro 43/100 — momentum 33, volatility 50, event-risk 60. Macro risk: moderate."
        },
        {
          layer: "internals",
          verdict: "bullish",
          score: 60,
          status: "available",
          reasoning: "Internals 60/100 — VIX component 50, breadth 60, participation 75."
        }
      ]
    });
    const news = enriched.layers.find((l) => l.key === "news")!;
    expect(evidenceLayerDisplayExplanation(news)).not.toMatch(/\/100/);
    expect(news.keyPoints.every((p) => !layerCopyLooksInternal(p))).toBe(true);

    const macro = enriched.layers.find((l) => l.key === "macro")!;
    expect(evidenceLayerDisplayExplanation(macro)).not.toContain("43/100");

    const internals = enriched.layers.find((l) => l.key === "internals")!;
    expect(evidenceLayerDisplayExplanation(internals)).not.toContain("60/100");
  });

  test("filterInternalLayerScoreCopy removes score-only reasoning", () => {
    expect(
      filterInternalLayerScoreCopy("news", [
        "News score 92/100 from 2 quality articles (blended sentiment +0.83)."
      ])
    ).toEqual([]);
  });
});
