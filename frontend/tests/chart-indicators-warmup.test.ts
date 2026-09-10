import { describe, expect, test } from "vitest";

import {
  FETCH_LIMIT,
  MAX_SMA_PERIOD,
  MAX_SWING_SMA_PERIOD,
  POSITION_SMA_PERIODS,
  POSITION_VISIBLE_BARS,
  SWING_DAILY_VISIBLE_BARS,
  defaultTimeframe,
  fetchLimitFor,
  isIntradayTf,
  visibleBarsFor,
  type ChartTimeframe
} from "@/lib/charts/chart-config";
import { sma, type IndicatorBar } from "@/lib/charts/indicators";

function dailyBars(count: number): IndicatorBar[] {
  const out: IndicatorBar[] = [];
  for (let i = 0; i < count; i += 1) {
    const close = 100 + Math.sin(i / 7) * 5 + i * 0.05;
    out.push({
      time: { year: 2026, month: 1, day: 1 }, // time value irrelevant to SMA coverage math
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1_000
    });
  }
  return out;
}

describe("chart warmup invariant", () => {
  test("sma() is a true rolling SMA — first value at the period-th bar, not before", () => {
    const bars = dailyBars(60);
    const s50 = sma(bars, 50);
    // 60 bars, period 50 -> 60 - 50 + 1 = 11 points (no expanding/min-period warmup).
    expect(s50).toHaveLength(11);
    // First point equals the mean of the first 50 closes.
    const mean = bars.slice(0, 50).reduce((a, b) => a + b.close, 0) / 50;
    expect(s50[0].value).toBeCloseTo(mean, 10);
  });

  test("daily fetch depth covers SMA 200 across the whole default swing viewport", () => {
    // The load-bearing fix: fetch >= visible window + longest SMA period so the
    // full viewport has a valid SMA 200 (previously 280 < 126 + 200).
    expect(FETCH_LIMIT["1day"] - SWING_DAILY_VISIBLE_BARS).toBeGreaterThanOrEqual(MAX_SWING_SMA_PERIOD);
  });

  test("SMA 20/50/200 all have a value for every bar in the visible daily window", () => {
    const bars = dailyBars(FETCH_LIMIT["1day"]);
    // The visible window is the last SWING_DAILY_VISIBLE_BARS bars → indices
    // [firstVisibleBarIdx .. last]. sma(period)'s first value lands on bar index
    // (period - 1). Full coverage ⟺ that first SMA bar is at or before the
    // window's left edge.
    const firstVisibleBarIdx = bars.length - SWING_DAILY_VISIBLE_BARS;
    for (const period of [20, 50, MAX_SWING_SMA_PERIOD]) {
      const pts = sma(bars, period);
      expect(pts).toHaveLength(bars.length - period + 1); // exact rolling count
      expect(period - 1).toBeLessThanOrEqual(firstVisibleBarIdx); // no gap in the viewport
    }
  });

  test("timeframe helpers behave as expected", () => {
    expect(isIntradayTf("5min")).toBe(true);
    expect(isIntradayTf("1day")).toBe(false);
    expect(isIntradayTf("1month")).toBe(false);
    expect(defaultTimeframe("day", undefined)).toBe("5min");
    expect(defaultTimeframe("swing", undefined)).toBe("1day");
    expect(defaultTimeframe("swing", "1week")).toBe("1week");
  });
});

describe("long-term (position) chart config", () => {
  test("defaults to weekly candles", () => {
    expect(defaultTimeframe("position", undefined)).toBe("1week");
    // Explicit timeframe still wins (user can switch to monthly/daily).
    expect(defaultTimeframe("position", "1month")).toBe("1month");
  });

  test("longest MA drawn is <= MAX_SMA_PERIOD", () => {
    expect(Math.max(...POSITION_SMA_PERIODS)).toBeLessThanOrEqual(MAX_SMA_PERIOD);
  });

  const longTermTfs: Array<"1day" | "1week" | "1month"> = ["1day", "1week", "1month"];

  test("fetch depth covers the longest MA across the whole visible window", () => {
    for (const tf of longTermTfs) {
      const fetched = fetchLimitFor("position", tf);
      const visible = POSITION_VISIBLE_BARS[tf];
      expect(visibleBarsFor("position", tf)).toBe(visible);
      // fetched - visible warmup bars must cover SMA 200 so the MA is valid
      // across the entire on-screen window (same invariant as the swing daily fix).
      expect(fetched - visible).toBeGreaterThanOrEqual(MAX_SMA_PERIOD);
    }
  });

  test("position deepens history vs the shallow swing defaults", () => {
    // The long-term desk must NOT reuse swing's shallow weekly/monthly fetch.
    expect(fetchLimitFor("position", "1week")).toBeGreaterThan(FETCH_LIMIT["1week"]);
    // Swing/day/legacy are unchanged by the long-term deepening.
    expect(fetchLimitFor("swing", "1day")).toBe(FETCH_LIMIT["1day"]);
    expect(fetchLimitFor(undefined, "5min" as ChartTimeframe)).toBe(FETCH_LIMIT["5min"]);
  });

  test("SMA 50/100/200 all have a value for every visible weekly bar", () => {
    const fetched = fetchLimitFor("position", "1week");
    const bars = dailyBars(fetched); // time values irrelevant to SMA coverage math
    const firstVisibleBarIdx = bars.length - POSITION_VISIBLE_BARS["1week"];
    for (const period of POSITION_SMA_PERIODS) {
      const pts = sma(bars, period);
      expect(pts).toHaveLength(bars.length - period + 1);
      expect(period - 1).toBeLessThanOrEqual(firstVisibleBarIdx);
    }
  });
});
