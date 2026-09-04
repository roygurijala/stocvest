import { describe, expect, it } from "vitest";
import {
  formatSectorHeatPct,
  sectorHeatCellBackground,
  sectorHeatGridColumns,
  sectorHeatIntensity,
  sectorHeatPrimaryPct,
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
});
