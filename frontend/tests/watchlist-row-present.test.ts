import { describe, expect, test } from "vitest";

import {
  buildWatchlistDeskStatusPresent,
  buildWatchlistPortfolioHeadline,
  watchlistLayerFillPct
} from "@/lib/watchlist-row-present";

describe("watchlist-row-present", () => {
  test("layer fill from alignment counts", () => {
    expect(watchlistLayerFillPct({ layers_aligned: 4, layers_total: 6, state: "developing" })).toBe(67);
  });

  test("desk status uses readiness as secondary", () => {
    const present = buildWatchlistDeskStatusPresent({
      state: "developing",
      layers_aligned: 4,
      layers_total: 6,
      readiness_label: "Ready for next session"
    });
    expect(present?.primary).toMatch(/Near ready/i);
    expect(present?.secondary).toBe("Ready for next session");
    expect(present?.progression).toBeNull();
  });

  test("portfolio headline summarizes actionable and developing", () => {
    expect(
      buildWatchlistPortfolioHeadline({
        actionable: 2,
        developing: 3,
        notAligned: 1,
        invalidated: 0,
        monitored: 6
      })
    ).toBe("2 actionable · 3 developing");
  });
});
