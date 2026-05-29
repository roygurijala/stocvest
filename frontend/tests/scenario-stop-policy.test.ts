import { describe, expect, test } from "vitest";
import {
  applyMinStopDistance,
  classifyEntryEdge,
  effectiveEntryZoneForClassification,
  minStopDistanceUsd,
  suggestStopForEntry
} from "@/lib/scenario/scenario-stop-policy";

describe("scenario-stop-policy", () => {
  test("minStopDistanceUsd tiers AMZN vs penny", () => {
    expect(minStopDistanceUsd(272)).toBeGreaterThanOrEqual(1.25);
    expect(minStopDistanceUsd(5)).toBeGreaterThanOrEqual(0.08);
  });

  test("suggestStopForEntry fixes long with entry below structural stop", () => {
    const stop = suggestStopForEntry({
      direction: "bullish",
      entry: 5.05,
      structuralStop: 5.1696,
      zoneLo: 5.18,
      zoneHi: 5.52,
      atr: 0.15
    });
    expect(stop).not.toBeNull();
    expect(stop!).toBeLessThan(5.05);
    expect(5.05 - stop!).toBeGreaterThanOrEqual(minStopDistanceUsd(5.05, 0.15) - 0.001);
  });

  test("applyMinStopDistance widens tight AMZN stop", () => {
    const widened = applyMinStopDistance("bullish", 272.12, 271.26, 2.5);
    expect(272.12 - widened).toBeGreaterThanOrEqual(1.25);
  });

  test("classifyEntryEdge mid vs support", () => {
    expect(classifyEntryEdge(272, 268, 276)).toBe("mid_range");
    expect(classifyEntryEdge(269, 268, 276)).toBe("support");
    expect(classifyEntryEdge(276.5, 268, 276)).toBe("breakout");
  });

  test("effectiveEntryZoneForClassification prefers wider swing range", () => {
    const zone = effectiveEntryZoneForClassification({
      sessionLo: 268,
      sessionHi: 276,
      swingLo: 262,
      swingHi: 280
    });
    expect(zone.lo).toBe(262);
    expect(zone.hi).toBe(280);
    expect(classifyEntryEdge(272, zone.lo, zone.hi)).toBe("mid_range");
    expect(classifyEntryEdge(263, zone.lo, zone.hi)).toBe("support");
  });
});
