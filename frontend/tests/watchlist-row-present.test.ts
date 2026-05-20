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

  test("neutral bias uses Mostly neutral label (matches Signals)", () => {
    const present = buildWatchlistDeskStatusPresent(
      {
        state: "developing",
        bias: "neutral",
        layers_aligned: 4,
        layers_total: 6
      },
      "swing"
    );
    expect(present?.statusLine).toBe("SWING · Mostly neutral (4/6)");
  });

  test("ideal desk line uses SWING prefix and tier counts", () => {
    const present = buildWatchlistDeskStatusPresent(
      {
        state: "developing",
        layers_aligned: 3,
        layers_total: 6
      },
      "swing"
    );
    expect(present?.statusLine).toBe("SWING · Developing (3/6)");
  });

  test("detail line prefers readiness over progression", () => {
    const present = buildWatchlistDeskStatusPresent(
      {
        state: "developing",
        layers_aligned: 4,
        layers_total: 6,
        readiness_label: "Waiting on volume confirmation",
        previous_layers_aligned: 3,
        last_transition_type: "improved"
      },
      "swing"
    );
    expect(present?.detailLine).toBe("Waiting on volume confirmation");
    expect(present?.lastEvaluatedLine).toMatch(/Last evaluated|Not evaluated/);
  });

  test("detail line uses layers improved when no readiness", () => {
    const present = buildWatchlistDeskStatusPresent(
      {
        state: "developing",
        layers_aligned: 5,
        layers_total: 6,
        previous_layers_aligned: 3,
        last_transition_type: "improved"
      },
      "swing"
    );
    expect(present?.detailLine).toBe("2 layers improved today");
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
