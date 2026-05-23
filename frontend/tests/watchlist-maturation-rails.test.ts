import { describe, expect, it } from "vitest";
import {
  maturationRailKeyForState,
  symbolMatchesMaturationRail
} from "@/lib/watchlist-maturation-rails";

describe("watchlist-maturation-rails", () => {
  it("maps presentation states to rail keys", () => {
    expect(maturationRailKeyForState("actionable")).toBe("actionable");
    expect(maturationRailKeyForState("developing")).toBe("developing");
    expect(maturationRailKeyForState("re_evaluating")).toBe("developing");
    expect(maturationRailKeyForState("not_aligned")).toBe("notAligned");
    expect(maturationRailKeyForState("invalidated")).toBe("invalidated");
    expect(maturationRailKeyForState(undefined)).toBeNull();
  });

  it("matches symbols to the selected rail", () => {
    expect(symbolMatchesMaturationRail("actionable", "actionable")).toBe(true);
    expect(symbolMatchesMaturationRail("developing", "actionable")).toBe(false);
    expect(symbolMatchesMaturationRail("re_evaluating", "developing")).toBe(true);
    expect(symbolMatchesMaturationRail("not_aligned", "notAligned")).toBe(true);
  });
});
