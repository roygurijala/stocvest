import { describe, expect, test } from "vitest";

import { buildScenarioPlanningBundle } from "@/lib/scenario/scenario-planning-bundle";

describe("buildScenarioPlanningBundle", () => {
  test("uses composite levels when composite is present", () => {
    const bundle = buildScenarioPlanningBundle({
      symbol: "AAPL",
      tradingMode: "swing",
      composite: {
        signal_summary: "bullish",
        signal_score: 72,
        risk_reward: 2.5,
        market_regime: "neutral",
        historical_entry_zone: { low: 100, high: 102 },
        reference_stop_level: 98,
        reference_target_1: 110,
        layers: [
          { layer: "technical", score: 70, verdict: "bullish", status: "ok" },
          { layer: "news", score: 50, verdict: "neutral", status: "ok" },
          { layer: "macro", score: 50, verdict: "neutral", status: "ok" },
          { layer: "sector", score: 50, verdict: "neutral", status: "ok" },
          { layer: "geopolitical", score: 50, verdict: "neutral", status: "ok" },
          { layer: "internals", score: 50, verdict: "neutral", status: "ok" }
        ]
      },
      snapshot: { symbol: "AAPL", last_trade_price: 101 } as never
    });
    expect(bundle.fromComposite).toBe(true);
    expect(bundle.input.reference.stop).toBe(98);
    expect(bundle.input.reference.entry_low).toBe(100);
    expect(bundle.setupBias).toBe("Bullish");
  });

  test("watchlist without composite falls back to snapshot only", () => {
    const bundle = buildScenarioPlanningBundle({
      symbol: "NVDA",
      tradingMode: "day",
      composite: null,
      snapshot: { symbol: "NVDA", last_trade_price: 500, day_low: 490, change_percent: 1.2 } as never,
      maturation: { state: "developing", layers_aligned: 3, layers_total: 6, bias: "long" }
    });
    expect(bundle.fromComposite).toBe(false);
    expect(bundle.input.reference.current_price).toBe(500);
    expect(bundle.setupBias).toBe("Bullish");
    expect(bundle.readiness.layersAligned).toBe(3);
  });
});
