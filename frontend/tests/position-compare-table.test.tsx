import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PositionCompareTable } from "@/components/invest/position-compare-table";
import { colorTokens } from "@/lib/design-system";
import {
  buildPositionCompareMatrix,
  parsePositionCandidates
} from "@/lib/dashboard/position-ranked-home-present";

function pillar(id: string, score: number | null, verdict = "neutral") {
  return { pillar_id: id, label: `${id} label`, score, verdict, data_quality: "high" };
}

function matrix(symbols: string[]) {
  const cands = parsePositionCandidates({
    candidates: [
      {
        symbol: "AAPL",
        tier: "gem",
        fundamentals_score: 80,
        technical_score: 66,
        weakest_pillar_id: "F4",
        weakest_pillar_label: "Valuation",
        pillars: [pillar("F1", 80, "bullish"), pillar("F4", 40, "bearish")]
      },
      {
        symbol: "MSFT",
        tier: "strong",
        fundamentals_score: 72,
        technical_score: 60,
        pillars: [pillar("F1", 90, "bullish")]
      }
    ]
  })!.candidates;
  return buildPositionCompareMatrix(cands, symbols);
}

describe("PositionCompareTable", () => {
  it("renders a null-safe panel only when two or more names resolve", () => {
    const { container } = render(
      <PositionCompareTable matrix={matrix(["AAPL"])} colors={colorTokens.dark} accentColor="#2e8bff" />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the columns, pillar rows and the no-winner caption", () => {
    render(<PositionCompareTable matrix={matrix(["AAPL", "MSFT"])} colors={colorTokens.dark} accentColor="#2e8bff" />);
    expect(screen.getByTestId("position-compare-panel")).toBeTruthy();
    expect(screen.getByText("AAPL")).toBeTruthy();
    expect(screen.getByText("MSFT")).toBeTruthy();
    // F1 present for both, F4 only for AAPL (MSFT cell is a dash)
    expect(screen.getByTestId("position-compare-row-F1")).toBeTruthy();
    expect(screen.getByTestId("position-compare-row-F4")).toBeTruthy();
    // caption never crowns a winner
    expect(screen.getByText(/not a ranking/i)).toBeTruthy();
  });

  it("fires remove and clear callbacks", () => {
    const onRemove = vi.fn();
    const onClear = vi.fn();
    render(
      <PositionCompareTable
        matrix={matrix(["AAPL", "MSFT"])}
        colors={colorTokens.dark}
        accentColor="#2e8bff"
        onRemove={onRemove}
        onClear={onClear}
      />
    );
    fireEvent.click(screen.getByTestId("position-compare-remove-AAPL"));
    fireEvent.click(screen.getByTestId("position-compare-clear"));
    expect(onRemove).toHaveBeenCalledWith("AAPL");
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
