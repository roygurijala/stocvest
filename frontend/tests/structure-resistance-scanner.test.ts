import { describe, expect, test } from "vitest";
import {
  scanNearestResistanceAbove,
  swingPivotValues,
  type OhlcBar
} from "@/lib/structure-resistance-scanner";

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

  test("analyst target fills gap when chart resistance missing", () => {
    const level = scanNearestResistanceAbove(bars([3, 4.5, 6, 8, 9, 10.5, 11.4], 2), {
      last: 9.44,
      floorAbove: 11.4,
      extraLevels: [12.0]
    });
    expect(level).toBe(12);
  });
});
