import { describe, expect, it } from "vitest";
import {
  formatHeatVsGroup,
  heatGroupMedian,
  heatRelativeSizeWeights,
  heatRelativeTileLayout,
  heatVsGroupDelta
} from "@/lib/dashboard/trading-room/heat-group-present";

describe("heat-group-present", () => {
  it("computes median and vs-group delta", () => {
    expect(heatGroupMedian([1, 3, -1])).toBe(1);
    expect(heatVsGroupDelta(2.5, 1)).toBeCloseTo(1.5, 5);
    expect(formatHeatVsGroup(0.02)).toBe("≈ grp");
    expect(formatHeatVsGroup(0.4)).toBe("+0.4 vs grp");
  });

  it("assigns larger relative weights to names that diverged most from the median", () => {
    const weights = heatRelativeSizeWeights([2.1, -0.5, 0.1], 0.1);
    expect(weights[0]).toBeGreaterThan(weights[1]!);
    expect(weights[1]).toBeGreaterThan(weights[2]!);
    const leader = heatRelativeTileLayout(weights[0]!);
    const laggard = heatRelativeTileLayout(weights[2]!);
    expect(leader.basisPx).toBeGreaterThan(laggard.basisPx);
    expect(leader.height).toBeGreaterThan(laggard.height);
    expect(leader.flex).toMatch(/^0 0 \d+px$/);
  });
});
