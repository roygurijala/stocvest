import type { ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ScannerWhyMissingPanel } from "@/components/scanner/scanner-why-missing-panel";
import { ThemeProvider } from "@/lib/theme-provider";

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("<ScannerWhyMissingPanel />", () => {
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

  test("shows fallback copy when symbol is not in sampled rejections", () => {
    wrap(
      <ScannerWhyMissingPanel
        rejectedSamples={[{ symbol: "MU", reason: "gap_below_2.0pct" }]}
        rejectionReasonCounts={{ "gap_below_2.0pct": 8 }}
        suggestedSymbols={["MU"]}
      />
    );

    fireEvent.change(screen.getByTestId("scanner-why-missing-input"), { target: { value: "AAPL" } });
    expect(screen.getByTestId("scanner-why-missing-not-found")).toHaveTextContent(
      "AAPL is not in the latest sampled rejections"
    );
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
});
