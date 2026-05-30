import { describe, expect, test } from "vitest";

import {
  executionReadinessLabel,
  resolveExecutionDisplay,
  resolveRegularSessionOpenFromSources
} from "@/lib/signals-page-present";

describe("resolveExecutionDisplay — session timing", () => {
  test("swing actionable after close plans for next open", () => {
    const d = resolveExecutionDisplay("actionable", {
      tradingMode: "swing",
      regularSessionOpen: false
    });
    expect(d.label).toContain("For next market open");
    expect(d.subline).toMatch(/next regular open/i);
    expect(d.tone).toBe("bullish");
    expect(d.gatesCleared).toBe(true);
  });

  test("day actionable after close shows session closed", () => {
    const d = resolveExecutionDisplay("actionable", {
      tradingMode: "day",
      regularSessionOpen: false
    });
    expect(d.label).toBe("Session closed");
    expect(d.subline).toMatch(/re-evaluates at next open/i);
    expect(d.tone).toBe("caution");
    expect(d.gatesCleared).toBe(false);
  });

  test("day actionable during regular session unchanged", () => {
    expect(
      executionReadinessLabel("actionable", { tradingMode: "day", regularSessionOpen: true })
    ).toBe("Actionable");
  });

  test("unknown session does not override actionable label", () => {
    expect(executionReadinessLabel("actionable", { tradingMode: "day" })).toBe("Actionable");
  });
});

describe("resolveRegularSessionOpenFromSources", () => {
  test("uses market status when present", () => {
    expect(
      resolveRegularSessionOpenFromSources({
        marketStatus: { market: "closed", exchanges: {}, currencies: {} },
        compositeMarketStatus: { is_market_open: true, next_open: null, market_session: "rth" }
      })
    ).toBe(false);
  });

  test("falls back to composite is_market_open", () => {
    expect(
      resolveRegularSessionOpenFromSources({
        compositeMarketStatus: { is_market_open: false, next_open: null, market_session: "closed" }
      })
    ).toBe(false);
  });
});
