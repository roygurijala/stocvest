import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { SignalsCommandBar } from "@/components/signals/signals-command-bar";
import { buildSignalsDeskVerdict } from "@/lib/signals-desk-kpi-present";
import { ThemeProvider } from "@/lib/theme-provider";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}));

vi.mock("@/components/info-tip", () => ({
  InfoTip: ({ label }: { label?: string }) => (
    <button type="button" aria-label={label ?? "More info"}>
      ⓘ
    </button>
  )
}));

describe("SignalsCommandBar", () => {
  test("renders open full evidence in command bar when handler provided", () => {
    const onOpenEvidence = vi.fn();
    render(
      <ThemeProvider>
        <SignalsCommandBar
          symbol="AAPL"
          tradingMode="swing"
          dayTradingSurfaces={false}
          watchlistControl={<span>Watchlist</span>}
          maturationLine={null}
          evaluationFreshness={null}
          onTradingModeChange={vi.fn()}
          onOpenEvidence={onOpenEvidence}
        />
      </ThemeProvider>
    );
    const btn = screen.getByTestId("signals-open-evidence-button");
    expect(btn).toHaveTextContent("Open full evidence");
    expect(screen.getByTestId("signals-desk-actions")).toContainElement(btn);
    expect(screen.getByTestId("signals-desk-mode-controls")).not.toContainElement(btn);
    expect(screen.queryByTestId("signals-open-evidence-button-mobile")).toBeNull();
    fireEvent.click(btn);
    expect(onOpenEvidence).toHaveBeenCalledTimes(1);
  });

  test("shows last price inline beside symbol when priceContext provided", () => {
    render(
      <ThemeProvider>
        <SignalsCommandBar
          symbol="AAPL"
          tradingMode="swing"
          dayTradingSurfaces={false}
          watchlistControl={<span>Watchlist</span>}
          maturationLine={null}
          evaluationFreshness={null}
          onTradingModeChange={vi.fn()}
          priceContext={{
            priceLabel: "Last",
            priceFormatted: "$185.20",
            dayChangePct: 1.2,
            dayChangeFormatted: "+1.2%",
            dayChangeTone: "up",
            accessibleLabel: "Last $185.20, +1.2% today. Context only."
          }}
        />
      </ThemeProvider>
    );
    const row = screen.getByTestId("signals-command-bar-price");
    expect(row).toHaveTextContent("Last");
    expect(row).toHaveTextContent("$185.20");
    expect(row).toHaveTextContent("+1.2%");
  });

  test("shows compact mode line and hides cadence paragraphs", () => {
    render(
      <ThemeProvider>
        <SignalsCommandBar
          symbol="AAPL"
          tradingMode="day"
          dayTradingSurfaces
          watchlistControl={<span>Watchlist</span>}
          maturationLine={null}
          evaluationFreshness={{ phase: "ready", label: "Last evaluated: May 21, 4:11 PM ET" }}
          onTradingModeChange={vi.fn()}
        />
      </ThemeProvider>
    );
    const line = screen.getByTestId("signals-mode-eval-line");
    expect(line).toHaveTextContent("Mode: Day");
    expect(line).toHaveTextContent("Last evaluated May 21, 4:11 PM ET");
    expect(screen.getByLabelText("About Day desk evaluation")).toBeInTheDocument();
    expect(screen.queryByText(/Swing desk:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Evaluated on live session structure/)).not.toBeInTheDocument();
  });

  test("renders inline verdict row when deskVerdict provided", () => {
    const onDeskKpiTarget = vi.fn();
    const verdict = buildSignalsDeskVerdict({
      bias: "Bullish",
      rows: [
        { key: "technical", name: "Technical", status: "Bullish", explanation: "", score: 70 },
        { key: "news", name: "News", status: "Bullish", explanation: "", score: 65 },
        { key: "macro", name: "Macro", status: "Neutral", explanation: "", score: 50 },
        { key: "sector", name: "Sector", status: "Bullish", explanation: "", score: 68 },
        { key: "geopolitical", name: "Geopolitical", status: "Neutral", explanation: "", score: 50 },
        { key: "internals", name: "Market Internals", status: "Bullish", explanation: "", score: 72 }
      ],
      tradingMode: "swing",
      decision: {
        state: "monitor",
        line: "Setup is forming",
        reinforcements: [],
        rationale: { category: "alignment", detail: "Waiting on confirmation" }
      }
    });
    render(
      <ThemeProvider>
        <SignalsCommandBar
          symbol="AAPL"
          tradingMode="swing"
          dayTradingSurfaces={false}
          watchlistControl={<span>Watchlist</span>}
          maturationLine={null}
          evaluationFreshness={null}
          onTradingModeChange={vi.fn()}
          deskVerdict={verdict}
          activeDeskTab="setup"
          decisionState="monitor"
          onDeskKpiTarget={onDeskKpiTarget}
        />
      </ThemeProvider>
    );
    expect(screen.getByTestId("signals-desk-verdict-row")).toBeInTheDocument();
    expect(screen.getByTestId("signals-desk-kpi-bias")).toHaveTextContent("Bullish");
    fireEvent.click(screen.getByTestId("signals-desk-verdict-execution"));
    expect(onDeskKpiTarget).toHaveBeenCalledWith("execution");
  });

  test("renders direction chip when provided", () => {
    render(
      <ThemeProvider>
        <SignalsCommandBar
          symbol="NVDA"
          tradingMode="swing"
          dayTradingSurfaces={false}
          watchlistControl={<span>Watchlist</span>}
          maturationLine={null}
          evaluationFreshness={null}
          onTradingModeChange={vi.fn()}
          directionChip={{
            label: "No edge",
            color: "#888",
            background: "rgba(0,0,0,0.1)"
          }}
        />
      </ThemeProvider>
    );
    expect(screen.getByTestId("signals-command-bar-direction-chip")).toHaveTextContent("No edge");
  });
});
