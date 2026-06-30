import { describe, expect, test } from "vitest";
import {
  buildEntryDistanceWarning,
  distanceTierLabel,
  entryQualityTierLabel,
  formatIdealPullbackZone,
  parseEntryDistanceTier
} from "@/lib/entry-zone";

describe("entry-zone helpers", () => {
  test("parseEntryDistanceTier", () => {
    expect(parseEntryDistanceTier("ideal")).toBe("ideal");
    expect(parseEntryDistanceTier("nope")).toBeNull();
  });

  test("buildEntryDistanceWarning for chasing", () => {
    expect(
      buildEntryDistanceWarning({ distanceTier: "ideal", distanceAtr: 0.3, anchor: 100 })
    ).toBeNull();
    const msg = buildEntryDistanceWarning({ distanceTier: "chasing", distanceAtr: 2.1, anchor: 100 });
    expect(msg).toContain("2.1× ATR");
    expect(msg).toContain("$100.00");
  });

  test("labels and ideal zone format", () => {
    expect(distanceTierLabel("chasing")).toBe("Chasing");
    expect(entryQualityTierLabel("high")).toBe("High quality");
    expect(formatIdealPullbackZone({ low: 99.2, high: 100.8 })).toBe("$99.20 – $100.80");
  });
});
