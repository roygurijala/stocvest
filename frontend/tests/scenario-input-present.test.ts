import { describe, expect, test } from "vitest";
import { canOpenFullScenarioSheet } from "@/lib/scenario/eligibility";
import {
  buildScenarioInputFromCompositeContext,
  buildWatchlistScenarioInput,
  marketRegimeToVolatilityRegime,
  setupBiasToScenarioDirection
} from "@/lib/scenario/scenario-input-present";
import { buildScenarioPlanningBundle } from "@/lib/scenario/scenario-planning-bundle";

describe("scenario-input-present", () => {
  test("setupBiasToScenarioDirection maps bullish and bearish", () => {
    expect(setupBiasToScenarioDirection("Bullish")).toBe("bullish");
    expect(setupBiasToScenarioDirection("Bearish")).toBe("bearish");
    expect(setupBiasToScenarioDirection("Neutral")).toBe("neutral");
  });

  test("marketRegimeToVolatilityRegime parses risk_on", () => {
    expect(marketRegimeToVolatilityRegime("risk_on")).toBe("low");
  });

  test("buildScenarioInputFromCompositeContext maps swing range and stop provenance", () => {
    const input = buildScenarioInputFromCompositeContext({
      symbol: "amzn",
      tradingMode: "swing",
      setupBias: "Bullish",
      composite: {
        signal_score: 72,
        risk_reward: 2.5,
        market_regime: "neutral",
        historical_entry_zone: { low: 269.64, high: 274.75 },
        swing_range_zone: { low: 262, high: 276, sessions: 10 },
        reference_stop_level: 269.1,
        reference_stop_provenance: "Below min(session low, VWAP) — structural buffer",
        reference_target_1: 274.75
      }
    });
    expect(input.reference.swing_range_low).toBe(262);
    expect(input.reference.swing_range_high).toBe(276);
    expect(input.reference.swing_range_sessions).toBe(10);
    expect(input.reference.stop_provenance).toContain("VWAP");
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
        session_entry_zone: { low: 100, high: 102 },
        swing_range_zone: { low: 95, high: 108, sessions: 10 },
        reference_stop_level: 98,
        reference_stop_provenance: "Below session low — structural buffer",
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

  test("buildScenarioInputFromCompositeContext derives levels from after_hours_price when last is missing", () => {
    const input = buildScenarioInputFromCompositeContext({
      symbol: "TJX",
      tradingMode: "swing",
      setupBias: "Bullish",
      composite: {
        signal_score: 68,
        signal_summary: "bullish",
        historical_entry_zone: { low: 123.5, high: 126.0 }
      },
      snapshot: {
        symbol: "TJX",
        after_hours_price: 125.42,
        prev_close: 124.2,
        day_low: 124.0,
        day_high: 126.8
      } as never
    });
    expect(input.reference.current_price).toBe(125.42);
    expect(canOpenFullScenarioSheet(input)).toBe(true);
  });

  test("buildScenarioInputFromCompositeContext derives levels from day_close when last is missing", () => {
    const input = buildScenarioInputFromCompositeContext({
      symbol: "TJX",
      tradingMode: "swing",
      setupBias: "Bullish",
      composite: {
        signal_score: 68,
        signal_summary: "bullish",
        alignment_ratio: 1,
        risk_reward: 1.4,
        historical_entry_zone: { low: 123.5, high: 126.0 }
      },
      snapshot: {
        symbol: "TJX",
        day_close: 125.5,
        prev_close: 124.2,
        day_low: 124.0,
        day_high: 126.8
      } as never
    });
    expect(input.reference.current_price).toBe(125.5);
    expect(input.reference.stop).not.toBeNull();
    expect(input.reference.target_1).not.toBeNull();
    expect(canOpenFullScenarioSheet(input)).toBe(true);
  });

  test("buildScenarioPlanningBundle opens full sheet for TJX-like after-hours snapshot", () => {
    const bundle = buildScenarioPlanningBundle({
      symbol: "TJX",
      tradingMode: "swing",
      setupBias: "Bullish",
      composite: {
        signal_summary: "bullish",
        signal_score: 68,
        alignment_ratio: 1,
        historical_entry_zone: { low: 123.5, high: 126.0 },
        layers: [{ layer: "technical", score: 70, verdict: "bullish", status: "ok" }]
      },
      snapshot: {
        symbol: "TJX",
        day_close: 125.5,
        prev_close: 124.2,
        day_low: 124.0,
        day_high: 126.8
      } as never
    });
    expect(canOpenFullScenarioSheet(bundle.input)).toBe(true);
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
