import { describe, expect, it } from "vitest";
import {
  buildScannerUnifiedHeadline,
  formatScannerNearAlignmentLine,
  scannerProgressOneLinerSuffix
} from "@/lib/scanner-progress-messaging";

describe("buildScannerUnifiedHeadline", () => {
  it("near-qual when nothing qualifies", () => {
    expect(
      buildScannerUnifiedHeadline({
        qualifyingTotal: 0,
        nearCount: 2,
        progressionCount: 0,
        watchlist: { monitored: 5, actionable: 0, developing: 1, inactive: 4 }
      })
    ).toBe("Nothing ready — 2 setups approaching threshold");
  });

  it("watchlist developing when no near rows", () => {
    expect(
      buildScannerUnifiedHeadline({
        qualifyingTotal: 0,
        nearCount: 0,
        progressionCount: 0,
        watchlist: { monitored: 4, actionable: 0, developing: 3, inactive: 1 }
      })
    ).toBe("Nothing ready — 3 watchlist symbols developing");
  });
});

describe("formatScannerNearAlignmentLine", () => {
  it("4/6 shows near ready and layers from threshold", () => {
    const line = formatScannerNearAlignmentLine(4, 6);
    expect(line.chip).toContain("Near ready");
    expect(line.chip).toContain("1 layer from threshold");
    expect(line.layersAway).toBe(1);
  });
});

describe("scannerProgressOneLinerSuffix", () => {
  it("mentions near-qual count for desk empty states", () => {
    const suffix = scannerProgressOneLinerSuffix({
      nearQualificationCount: 1,
      watchlistDeveloping: 2,
      watchlistActionable: 0,
      watchlistMonitored: 5
    });
    expect(suffix).toContain("approaching the setup threshold");
  });
});
