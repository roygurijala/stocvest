import { describe, expect, test } from "vitest";
import {
  buildScenarioInputFromCompositeContext,
  buildWatchlistScenarioInput,
  marketRegimeToVolatilityRegime,
  setupBiasToScenarioDirection
} from "@/lib/scenario/scenario-input-present";

describe("scenario-input-present", () => {
  test("setupBiasToScenarioDirection maps bullish and bearish", () => {
    expect(setupBiasToScenarioDirection("Bullish")).toBe("bullish");
    expect(setupBiasToScenarioDirection("Bearish")).toBe("bearish");
    expect(setupBiasToScenarioDirection("Neutral")).toBe("neutral");
  });

  test("marketRegimeToVolatilityRegime parses risk_on", () => {
    expect(marketRegimeToVolatilityRegime("risk_on")).toBe("low");
  });

  test("buildScenarioInputFromCompositeContext uses composite zone", () => {
    const input = buildScenarioInputFromCompositeContext({
      symbol: "aapl",
      tradingMode: "swing",
      setupBias: "Bullish",
      composite: {
        signal_score: 72,
        risk_reward: 2.5,
        market_regime: "neutral",
        historical_entry_zone: { low: 100, high: 102 },
        reference_stop_level: 98,
        reference_target_1: 110
      }
    });
    expect(input.symbol).toBe("AAPL");
    expect(input.direction).toBe("bullish");
    expect(input.reference.entry_low).toBe(100);
    expect(input.reference.stop).toBe(98);
  });

  test("buildScenarioInputFromCompositeContext derives stop and target from snapshot when composite omits them", () => {
    const input = buildScenarioInputFromCompositeContext({
      symbol: "GS",
      tradingMode: "swing",
      setupBias: "Bullish",
      composite: {
        signal_score: 68,
        risk_reward: 1.3,
        market_regime: "neutral",
        historical_entry_zone: { low: 380, high: 385 }
      },
      snapshot: {
        symbol: "GS",
        last_trade_price: 382,
        day_low: 375,
        day_high: 390,
        prev_close: 378
      } as never
    });
    expect(input.reference.stop).not.toBeNull();
    expect(input.reference.target_1).not.toBeNull();
    expect(input.risk_reward).toBe(1.3);
  });

  test("buildWatchlistScenarioInput uses snapshot last and day_low", () => {
    const input = buildWatchlistScenarioInput({
      symbol: "nvda",
      mode: "day",
      quoteBullish: true,
      snapshot: { symbol: "NVDA", last_trade_price: 500, day_low: 490 } as never
    });
    expect(input.symbol).toBe("NVDA");
    expect(input.direction).toBe("bullish");
    expect(input.reference.current_price).toBe(500);
    expect(input.reference.stop).toBe(490);
  });
});
