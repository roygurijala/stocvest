import { describe, expect, test } from "vitest";
import {
  countMarketBriefExpandedSections,
  marketBriefExpandButtonLabel,
  marketBriefExpandedHeadlines
} from "@/lib/dashboard/trading-room/market-brief-scan-present";

describe("market-brief-scan-present", () => {
  test("counts expandable sections for prep and movers", () => {
    const n = countMarketBriefExpandedSections(
      {
        headlines: [{ id: "1" }, { id: "2" }],
        movers: { up: [{}], down: [] },
        weekAhead: [{}],
        outcomesRecap: {},
        watchlistAtClose: [{}],
        weekInReview: { bestSector: {}, worstSector: null }
      },
      true
    );
    expect(n).toBe(6);
  });

  test("expand label reflects section count", () => {
    expect(marketBriefExpandButtonLabel(3, false)).toBe("Expand brief · 3 sections");
    expect(marketBriefExpandButtonLabel(1, false)).toBe("Expand brief · 1 section");
    expect(marketBriefExpandButtonLabel(2, true)).toBe("Show less");
    expect(marketBriefExpandButtonLabel(0, false)).toBeNull();
  });

  test("expanded headlines include full feed", () => {
    const headlines = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(marketBriefExpandedHeadlines(headlines).map((h) => h.id)).toEqual(["a", "b", "c"]);
    expect(marketBriefExpandedHeadlines([])).toEqual([]);
  });

  test("single headline counts as expandable section", () => {
    expect(
      countMarketBriefExpandedSections(
        {
          headlines: [{ id: "1" }],
          movers: { up: [], down: [] },
          weekAhead: [],
          outcomesRecap: null,
          watchlistAtClose: [],
          weekInReview: null
        },
        false
      )
    ).toBe(1);
  });
});
