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

  test("maturation API shape exposes readiness on status note", () => {
    const present = buildWatchlistDeskStatusPresent(
      {
        state: "developing",
        label: "Developing",
        layers_aligned: 4,
        layers_total: 6,
        readiness_label: "Ready for next session",
        previous_layers_aligned: 3,
        last_transition_type: "improved"
      },
      "swing"
    );
    expect(present?.statusLine).toMatch(/Near ready \(4\/6\)/);
    expect(present?.statusNote).toBe("Ready for next session");
  });

  test("status note prefers unique readiness over progression", () => {
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
    expect(present?.statusNote).toBe("Waiting on volume confirmation");
    expect(present?.lastEvaluatedLine).toMatch(/Last evaluated|Not evaluated/);
  });

  test("status note uses layers improved when readiness duplicates X/6", () => {
    const present = buildWatchlistDeskStatusPresent(
      {
        state: "developing",
        layers_aligned: 5,
        layers_total: 6,
        readiness_label: "5/6 aligned — core ✓",
        previous_layers_aligned: 3,
        last_transition_type: "improved",
        missing_layers: ["sector"]
      },
      "swing"
    );
    expect(present?.statusNote).toBe("2 layers improved today");
    expect(present?.coreCheckmark).toBe(true);
  });

  test("core checkmark when technical and news are aligned", () => {
    const present = buildWatchlistDeskStatusPresent(
      {
        state: "actionable",
        layers_aligned: 6,
        layers_total: 6,
        readiness_label: "6/6 aligned — core ✓",
        missing_layers: []
      },
      "day"
    );
    expect(present?.coreCheckmark).toBe(true);
    expect(present?.statusNote).toBeNull();
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
