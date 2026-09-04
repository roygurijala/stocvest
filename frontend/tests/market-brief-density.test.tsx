import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarketBrief, type MarketBriefData } from "@/components/dashboard/trading-room/market-brief";

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
      caution: "#f59e0b",
      accent: "#3b82f6"
    },
    theme: "dark"
  })
}));

function minimalBrief(overrides: Partial<MarketBriefData> = {}): MarketBriefData {
  return {
    marketOpen: true,
    marketStatusLabel: "Market open",
    regimeLabel: "Neutral",
    sessionNarrative: "Tape is mixed.",
    aiNarrative: null,
    spyPct: 0.1,
    qqqPct: 0.2,
    iwmPct: -0.1,
    vixLevel: 15,
    vixPct: -1,
    breadthLine: null,
    sectors: [],
    sectorWindowLabel: "today",
    movers: { up: [], down: [] },
    headlines: [],
    counts: { actionable: 0, near: 0, potential: 0, cooling: 0 },
    topCard: null,
    watchLine: null,
    watchDetail: null,
    updatedAtIso: null,
    sessionPhase: "regular",
    weekAhead: [],
    watchlistAtClose: [],
    weekInReview: null,
    outcomesRecap: null,
    ...overrides
  };
}

describe("MarketBrief density (ADR-003 UX-D1)", () => {
  it("does not render the market swing setups table on the dashboard brief", () => {
    render(
      <MarketBrief
        data={minimalBrief()}
        onViewTopSetup={() => {}}
        onSelectSymbol={() => {}}
      />
    );
    expect(screen.queryByTestId("market-swing-setups-table")).toBeNull();
    expect(screen.queryByText("Swing setups from market scan")).toBeNull();
  });
});

describe("MarketBrief scan mode (ADR-003 UX-D3)", () => {
  it("shows top headline in scan and hides movers until expanded", () => {
    render(
      <MarketBrief
        data={minimalBrief({
          headlines: [
            {
              id: "h1",
              title: "Fed signals patience",
              source: "Reuters",
              ageLabel: "2h",
              sentiment: "neutral",
              url: null,
              impact: "Rates steady"
            },
            {
              id: "h2",
              title: "Tech leads tape",
              source: "Bloomberg",
              ageLabel: "1h",
              sentiment: "bullish",
              url: null,
              impact: null
            }
          ],
          movers: {
            up: [{ symbol: "NVDA", company: null, changePct: 2.1, lane: "swing" }],
            down: []
          }
        })}
        onViewTopSetup={() => {}}
        onSelectSymbol={() => {}}
      />
    );

    expect(screen.getByTestId("market-brief-scan-headline")).toHaveTextContent("Fed signals patience");
    expect(screen.queryByText("Notable movers on the desk")).toBeNull();
    expect(screen.getByTestId("market-brief-expand-toggle")).toHaveTextContent("Expand brief · 2 sections");

    fireEvent.click(screen.getByTestId("market-brief-expand-toggle"));
    expect(screen.getByTestId("market-brief-expanded")).toBeInTheDocument();
    expect(screen.getByText("Notable movers on the desk")).toBeInTheDocument();
    expect(screen.getByText("More headlines")).toBeInTheDocument();
  });
});
