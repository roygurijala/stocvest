import { describe, expect, it } from "vitest";
import {
  formatSectorHeatPct,
  sectorBreadthCaption,
  sectorHeatCellBackground,
  sectorHeatGridColumns,
  sectorHeatIntensity,
  sectorHeatPrimaryPct,
  sectorRankBarTrackPct,
  sectorRankMaxAbs,
  sortSectorsForRank,
  SECTOR_HEAT_MAX_HOLDINGS
} from "@/lib/dashboard/trading-room/sector-heat-present";

const colors = {
  bullish: "#22c55e",
  bearish: "#ef4444",
  text: "#eee",
  textMuted: "#999",
  accent: "#3b82f6",
  surface: "#111",
  surfaceMuted: "#1a1a1a"
};

describe("sector-heat-present (ADR-003 UX-D6)", () => {
  it("picks 1-day pct when window is today", () => {
    expect(
      sectorHeatPrimaryPct(
        { symbol: "XLK", label: "Tech", pct: 0.5, pct1d: 1.2, pct5d: 0.3 },
        "today"
      )
    ).toBe(1.2);
  });

  it("picks 5-day pct when window is past week", () => {
    expect(
      sectorHeatPrimaryPct(
        { symbol: "XLK", label: "Tech", pct: 0.5, pct1d: 1.2, pct5d: 0.3 },
        "past week"
      )
    ).toBe(0.3);
  });

  it("scales intensity toward saturation cap", () => {
    expect(sectorHeatIntensity(1.25)).toBeCloseTo(0.5);
    expect(sectorHeatIntensity(5)).toBe(1);
  });

  it("builds bullish and bearish cell backgrounds", () => {
    expect(sectorHeatCellBackground(1.5, colors)).toMatch(/^#22c55e/i);
    expect(sectorHeatCellBackground(-1.5, colors)).toMatch(/^#ef4444/i);
  });

  it("uses wider grids as cell count grows", () => {
    expect(sectorHeatGridColumns(4)).toContain("repeat(2");
    expect(sectorHeatGridColumns(8)).toContain("repeat(4");
  });

  it("formats pct with sign", () => {
    expect(formatSectorHeatPct(1.23)).toBe("+1.2%");
    expect(formatSectorHeatPct(-0.4)).toBe("-0.4%");
    expect(formatSectorHeatPct(null)).toBe("—");
  });

  it("caps holdings at eight names", () => {
    expect(SECTOR_HEAT_MAX_HOLDINGS).toBe(8);
  });

  it("returns null primary pct when no quote is available", () => {
    expect(sectorHeatPrimaryPct({ symbol: "XLU", label: "Utilities", pct: null }, "today")).toBeNull();
  });

  it("ranks sectors by move and parks missing quotes last", () => {
    const ranked = sortSectorsForRank(
      [
        { symbol: "XLU", label: "Utilities", pct: null },
        { symbol: "XLK", label: "Tech", pct: 0.8, pct1d: 0.8 },
        { symbol: "XLC", label: "Comm", pct: -1.4, pct1d: -1.4 }
      ],
      "today"
    );
    expect(ranked.map((s) => s.symbol)).toEqual(["XLK", "XLC", "XLU"]);
  });

  it("scales diverging bars against the largest move", () => {
    expect(sectorRankMaxAbs([0.8, -1.4, 0])).toBe(1.4);
    expect(sectorRankBarTrackPct(1.4, 1.4)).toBe(50);
    expect(sectorRankBarTrackPct(-0.7, 1.4)).toBe(25);
    expect(sectorRankBarTrackPct(null, 1.4)).toBe(0);
  });

  it("writes a breadth caption from the 11-sector tape", () => {
    expect(
      sectorBreadthCaption(
        [
          { symbol: "XLK", label: "Tech", pct: 0.8, pct1d: 0.8 },
          { symbol: "XLF", label: "Financials", pct: 0, pct1d: 0 },
          { symbol: "XLC", label: "Comm", pct: -1.4, pct1d: -1.4 }
        ],
        "today"
      )
    ).toBe("1 of 3 sectors up · Tech leads, Comm lags");
  });
});
