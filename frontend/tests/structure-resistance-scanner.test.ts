import { describe, expect, test } from "vitest";
import {
  scanNearestResistanceAbove,
  scanNearestSupportBelow,
  swingPivotValues,
  type OhlcBar
} from "@/lib/structure-resistance-scanner";
import { nearestResistanceAbove } from "@/lib/structure-engine";

function bars(highs: number[], baseLow = 1): OhlcBar[] {
  return highs.map((h) => ({ low: baseLow, high: h }));
}

describe("structure-resistance-scanner", () => {
  test("detects pivot high", () => {
    const pivots = swingPivotValues(bars([10, 11, 12, 13.5, 12.5, 11.8, 11]), "high", true);
    expect(pivots).toContain(13.5);
  });

  test("ubxg-like returns null above session high in band", () => {
    const level = scanNearestResistanceAbove(bars([3, 4.5, 6, 8, 9, 10.5, 11.4], 2), {
      last: 9.44,
      floorAbove: 11.4
    });
    expect(level).toBeNull();
  });

  test("picks nearest resistance above T1", () => {
    const highs = [98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 111, 110, 109, 108];
    const level = scanNearestResistanceAbove(bars(highs), { last: 100, floorAbove: 105 });
    expect(level).toBe(112);
  });

  test("analyst target fills gap when chart resistance missing (legacy path)", () => {
    const level = scanNearestResistanceAbove(bars([3, 4.5, 6, 8, 9, 10.5, 11.4], 2), {
      last: 9.44,
      floorAbove: 11.4,
      extraLevels: [12.0]
    });
    expect(level).toBe(12);
  });

  test("atr path ignores analyst extras", () => {
    const daily = bars([101, 102, 103, 104, 105, 104.5, 103.5]);
    const level = scanNearestResistanceAbove(daily, {
      last: 100,
      floorAbove: 101,
      atr: 2,
      extraLevels: [200]
    });
    expect(level).not.toBe(200);
    expect(level).toBeLessThanOrEqual(106);
  });

  test("zone engine clusters repeated highs", () => {
    const zone = nearestResistanceAbove({
      last: 100,
      floorAbove: 101,
      atr: 2,
      dailyBars: bars([104, 104.1, 104], 101)
    });
    expect(zone).not.toBeNull();
    expect(zone!.touchCount).toBeGreaterThanOrEqual(2);
  });

  test("scanNearestSupportBelow uses atr window", () => {
    const level = scanNearestSupportBelow(
      [97, 96, 95, 94, 93].map((h) => ({ low: h - 1, high: h })),
      {
        last: 98,
        ceilingBelow: 97,
        atr: 2
      }
    );
    expect(level).not.toBeNull();
    expect(level!).toBeLessThan(98);
  });
});
