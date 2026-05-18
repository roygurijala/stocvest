import { describe, expect, test } from "vitest";
import { buildWatchlistMaturationLine } from "@/lib/hooks/use-watchlist-maturation-line";

describe("buildWatchlistMaturationLine", () => {
  test("returns null when symbol not on list", () => {
    expect(buildWatchlistMaturationLine(undefined, false)).toBeNull();
  });

  test("near ready display for 4/6 developing", () => {
    const line = buildWatchlistMaturationLine(
      { state: "developing", layers_aligned: 4, layers_total: 6 },
      true
    );
    expect(line?.label).toBe("Near ready (4/6)");
    expect(line?.layersAligned).toBe(4);
  });

  test("on watchlist when row has no state yet", () => {
    expect(buildWatchlistMaturationLine({}, true)?.label).toBe("On watchlist");
  });
});
