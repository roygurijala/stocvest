import { describe, expect, test } from "vitest";
import { buildMarketContextSnapshot, MARKET_CONTEXT_INDEX_FOOTNOTE } from "@/lib/market-context/snapshot";
import { volatilityPillLabel } from "@/lib/market-context/derivations";

describe("buildMarketContextSnapshot", () => {
  test("volatility pill uses Low band for contained VIX", () => {
    const snap = buildMarketContextSnapshot({
      weeklyIndexRows: [
        { symbol: "SPY", label: "Large cap", pct5d: 1, lastPrice: 500 },
        { symbol: "QQQ", label: "Tech", pct5d: 1, lastPrice: 400 },
        { symbol: "IWM", label: "Small cap", pct5d: 1, lastPrice: 200 }
      ],
      sectorRotation: [
        { symbol: "XLK", label: "Tech", pct5d: 1 },
        { symbol: "XLF", label: "Financials", pct5d: 0.5 },
        { symbol: "XLE", label: "Energy", pct5d: -0.2 }
      ],
      upcomingEarnings: [],
      macro: null,
      regimeLabel: "Neutral",
      regimePriceBreadthOnly: false,
      vixLevel: 17,
      vixSessionPct: 0.5,
      vixPulseOk: true,
      spyPct: 0.1,
      qqqPct: 0.1
    });
    const vol = snap.pills.find((p) => p.id === "volatility");
    expect(vol?.value).toBe(volatilityPillLabel("Contained", { vixPulseOk: true }));
    expect(vol?.value).toBe("Low");
    expect(snap.sessionToday.items).toHaveLength(2);
    expect(MARKET_CONTEXT_INDEX_FOOTNOTE).toBe("5-Day Trend (Context)");
  });

  test("volatility pill unknown when VIX pulse missing", () => {
    const snap = buildMarketContextSnapshot({
      weeklyIndexRows: [],
      sectorRotation: [],
      upcomingEarnings: [],
      macro: null,
      regimeLabel: "Bullish",
      regimePriceBreadthOnly: true,
      vixLevel: null,
      vixSessionPct: null,
      vixPulseOk: false,
      spyPct: 0.5,
      qqqPct: 0.4
    });
    const vol = snap.pills.find((p) => p.id === "volatility");
    expect(vol?.value).toBe("Unknown (breadth + price only)");
    expect(vol?.structured?.result).toMatch(/breadth \+ price only/i);
  });

  test("regime pill uses structured explain with why and advanced thresholds", () => {
    const snap = buildMarketContextSnapshot({
      weeklyIndexRows: [],
      sectorRotation: [],
      upcomingEarnings: [],
      macro: null,
      regimeLabel: "Bearish",
      regimePriceBreadthOnly: true,
      vixLevel: null,
      vixSessionPct: null,
      vixPulseOk: false,
      spyPct: -0.5,
      qqqPct: -0.4
    });
    const regime = snap.pills.find((p) => p.id === "regime");
    expect(regime?.value).toBe("Bearish");
    expect(regime?.structured?.result).toBe("Regime is Bearish");
    expect(regime?.structured?.advanced).toMatch(/SPY > \+0\.2%/);
    expect(snap.sessionToday.items.map((i) => i.symbol)).toEqual(["SPY", "QQQ"]);
  });
});
