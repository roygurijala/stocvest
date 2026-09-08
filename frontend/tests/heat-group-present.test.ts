import { describe, expect, it } from "vitest";
import {
  formatHeatVsGroup,
  heatGroupMedian,
  heatVsGroupDelta
} from "@/lib/dashboard/trading-room/heat-group-present";

describe("heat-group-present", () => {
  it("computes median and vs-group delta", () => {
    expect(heatGroupMedian([1, 3, -1])).toBe(1);
    expect(heatVsGroupDelta(2.5, 1)).toBeCloseTo(1.5, 5);
    expect(formatHeatVsGroup(0.02)).toBe("≈ grp");
    expect(formatHeatVsGroup(0.4)).toBe("+0.4 vs grp");
  });
});
