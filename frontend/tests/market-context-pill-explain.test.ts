import { describe, expect, test } from "vitest";
import { buildRegimeStructuredExplain, buildVolatilityStructuredExplain } from "@/lib/market-context/pill-explain";

describe("buildRegimeStructuredExplain", () => {
  test("bullish regime uses plain-language why and impact", () => {
    const ex = buildRegimeStructuredExplain({
      regimeLabel: "Bullish",
      spyPct: 0.89,
      qqqPct: 1.38,
      regimePriceBreadthOnly: false,
      vixPulseOk: true
    });
    expect(ex.result).toBe("Regime is Bullish");
    expect(ex.why.some((l) => l.includes("strong today"))).toBe(true);
    expect(ex.impact.some((l) => /long setups/i.test(l))).toBe(true);
    expect(ex.advanced).toMatch(/SPY > \+0\.2%/);
  });

  test("breadth-only note when VIX unavailable", () => {
    const ex = buildRegimeStructuredExplain({
      regimeLabel: "Bullish",
      spyPct: 0.5,
      qqqPct: 0.4,
      regimePriceBreadthOnly: true,
      vixPulseOk: false
    });
    expect(ex.why.some((l) => /VIX is unavailable/i.test(l))).toBe(true);
  });
});

describe("buildVolatilityStructuredExplain", () => {
  test("unknown volatility when VIX missing", () => {
    const ex = buildVolatilityStructuredExplain({
      category: "Unknown",
      vixPulseOk: false,
      regimePriceBreadthOnly: true
    });
    expect(ex.result).toMatch(/Unknown.*breadth \+ price only/i);
    expect(ex.why.some((l) => /VIX feed is unavailable/i.test(l))).toBe(true);
  });
});
