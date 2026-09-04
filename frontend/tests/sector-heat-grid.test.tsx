import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SectorHeatGrid } from "@/components/dashboard/trading-room/sector-heat-grid";
import { DATA_INTERACTION_LEVEL } from "@/lib/dashboard/click-hierarchy";

vi.mock("@/lib/theme-provider", () => ({
  useTheme: () => ({
    colors: {
      surface: "#111",
      surfaceMuted: "#1a1a1a",
      border: "#333",
      text: "#eee",
      textMuted: "#999",
      bullish: "#22c55e",
      bearish: "#ef4444",
      accent: "#3b82f6"
    },
    theme: "dark"
  })
}));

const colors = {
  surface: "#111",
  surfaceMuted: "#1a1a1a",
  border: "#333",
  text: "#eee",
  textMuted: "#999",
  bullish: "#22c55e",
  bearish: "#ef4444",
  caution: "#f59e0b",
  accent: "#3b82f6"
};

describe("SectorHeatGrid (ADR-003 UX-D6)", () => {
  it("renders ETF tiles and toggles sector selection at medium interaction level", () => {
    const onSelectSector = vi.fn();
    render(
      <SectorHeatGrid
        sectors={[
          { symbol: "XLK", label: "Tech", pct: 1.1, pct1d: 1.1, pct5d: 0.4 },
          { symbol: "XLF", label: "Financials", pct: -0.6, pct1d: -0.6, pct5d: -0.2 }
        ]}
        sectorWindowLabel="today"
        selectedSymbol={null}
        interactive
        colors={colors}
        onSelectSector={onSelectSector}
      />
    );

    expect(screen.getByTestId("market-brief-sector-heat-grid")).toBeInTheDocument();
    const tech = screen.getByTestId("market-brief-sector-heat-XLK");
    expect(tech).toHaveAttribute(DATA_INTERACTION_LEVEL, "medium");
    fireEvent.click(tech);
    expect(onSelectSector).toHaveBeenCalledWith("XLK");
  });
});
