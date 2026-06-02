import type { ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ScannerWhyMissingPanel } from "@/components/scanner/scanner-why-missing-panel";
import { ThemeProvider } from "@/lib/theme-provider";

const fetchSymbolSnapshotMock = vi.fn(async () => null);
const fetchDeskWhyMissingMock = vi.fn(async () => null);
vi.mock("@/lib/api/fetch-symbol-snapshot", () => ({
  fetchSymbolSnapshot: (...args: unknown[]) => fetchSymbolSnapshotMock(...args)
}));
vi.mock("@/lib/api/desk-today", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/desk-today")>("@/lib/api/desk-today");
  return {
    ...actual,
    fetchDeskWhyMissing: (...args: unknown[]) => fetchDeskWhyMissingMock(...args)
  };
});

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("<ScannerWhyMissingPanel />", () => {
  beforeEach(() => {
    fetchSymbolSnapshotMock.mockReset().mockResolvedValue(null);
    fetchDeskWhyMissingMock.mockReset().mockResolvedValue(null);
  });

  test("uses snapshot fallback reason for free-text symbol not in sampled rejections", async () => {
    fetchSymbolSnapshotMock.mockResolvedValueOnce({
      symbol: "PENNY",
      prev_close: 4.8,
      last_trade_price: 4.7,
      day_volume: 800000,
      prev_day_volume: 1200000
    });
    wrap(<ScannerWhyMissingPanel rejectedSamples={[]} showSymbolSuggestions={false} />);
    fireEvent.change(screen.getByTestId("scanner-why-missing-input"), { target: { value: "PENNY" } });
    expect(await screen.findByTestId("scanner-why-missing-snapshot-reason")).toHaveTextContent(
      "below the $5 minimum"
    );
  });

  test("prefers desk funnel diagnostic when desk mode lookup is enabled", async () => {
    fetchDeskWhyMissingMock.mockResolvedValueOnce({
      symbol: "NVDA",
      stage: "ranked_out",
      reason_code: "ranked_below_survivor_cutoff",
      reason: "Passed baseline filters but ranked #187, below this cycle's survivor cutoff of top 150."
    });
    wrap(
      <ScannerWhyMissingPanel
        rejectedSamples={[]}
        showSymbolSuggestions={false}
        deskModeForLookup="swing"
      />
    );
    fireEvent.change(screen.getByTestId("scanner-why-missing-input"), { target: { value: "NVDA" } });
    expect(await screen.findByTestId("scanner-why-missing-snapshot-reason")).toHaveTextContent(
      "ranked #187"
    );
  });

  test("shows plain-English reason for sampled rejected symbol", () => {
    wrap(
      <ScannerWhyMissingPanel
        rejectedSamples={[{ symbol: "NVDA", reason: "day_volume_below_500000" }]}
        rejectionReasonCounts={{ day_volume_below_500000: 12 }}
        suggestedSymbols={["NVDA", "AVGO"]}
      />
    );

    fireEvent.change(screen.getByTestId("scanner-why-missing-input"), { target: { value: "NVDA" } });
    expect(screen.getByTestId("scanner-why-missing-result")).toHaveTextContent("NVDA is currently filtered out");
    expect(screen.getByTestId("scanner-why-missing-reason")).toHaveTextContent(
      "Day volume below 500,000 shares minimum."
    );
    expect(screen.getByText(/Most common blockers this cycle/i)).toBeInTheDocument();
  });

  test("shows diagnostic reason instead of sampled-rejections fallback text", async () => {
    wrap(
      <ScannerWhyMissingPanel
        rejectedSamples={[{ symbol: "MU", reason: "gap_below_2.0pct" }]}
        rejectionReasonCounts={{ "gap_below_2.0pct": 8 }}
        suggestedSymbols={["MU"]}
      />
    );

    fireEvent.change(screen.getByTestId("scanner-why-missing-input"), { target: { value: "AAPL" } });
    expect(await screen.findByTestId("scanner-why-missing-snapshot-reason")).toHaveTextContent(
      "snapshot is unavailable right now"
    );
    expect(screen.queryByTestId("scanner-why-missing-not-found")).not.toBeInTheDocument();
  });

  test("prefills query from quick action symbol", () => {
    wrap(
      <ScannerWhyMissingPanel
        rejectedSamples={[{ symbol: "AVGO", reason: "gap_below_2.0pct" }]}
        rejectionReasonCounts={{ "gap_below_2.0pct": 3 }}
        suggestedSymbols={["AVGO"]}
        prefillSymbol="avgo"
      />
    );
    expect(screen.getByTestId("scanner-why-missing-input")).toHaveValue("AVGO");
    expect(screen.getByTestId("scanner-why-missing-result")).toHaveTextContent("AVGO is currently filtered out");
  });

  test("supports free-text lookup without suggestion dropdown", () => {
    wrap(
      <ScannerWhyMissingPanel
        rejectedSamples={[{ symbol: "NVDA", reason: "day_volume_below_500000" }]}
        showSymbolSuggestions={false}
      />
    );
    const input = screen.getByTestId("scanner-why-missing-input");
    expect(input).not.toHaveAttribute("list");
    fireEvent.change(input, { target: { value: "NVDA" } });
    expect(screen.getByTestId("scanner-why-missing-result")).toHaveTextContent("NVDA is currently filtered out");
  });

  test("uses Enter a symbol placeholder", () => {
    wrap(<ScannerWhyMissingPanel rejectedSamples={[]} showSymbolSuggestions={false} />);
    expect(screen.getByTestId("scanner-why-missing-input")).toHaveAttribute("placeholder", "Enter a symbol");
  });
});
