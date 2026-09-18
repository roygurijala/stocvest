import { describe, expect, test } from "vitest";
import {
  countMarketBriefExpandedSections,
  marketBriefExpandButtonLabel,
  marketBriefExpandedHeadlines,
  marketBriefScanHeadline,
  marketBriefScanMovers
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

  test("expanded headlines skip the scan-surface lead", () => {
    const headlines = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(marketBriefExpandedHeadlines(headlines).map((h) => h.id)).toEqual(["b", "c"]);
    expect(marketBriefExpandedHeadlines([])).toEqual([]);
  });

  test("scan surface keeps the lead headline and one mover each side", () => {
    expect(marketBriefScanHeadline([{ id: "a" }, { id: "b" }])?.id).toBe("a");
    expect(marketBriefScanHeadline([])).toBeNull();
    expect(
      marketBriefScanMovers({
        up: [{ id: "u1" }, { id: "u2" }],
        down: [{ id: "d1" }]
      })
    ).toEqual({ up: [{ id: "u1" }], down: [{ id: "d1" }] });
  });

  test("single headline stays on scan and is not expandable", () => {
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
    ).toBe(0);
  });
});
