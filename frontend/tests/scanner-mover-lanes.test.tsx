import type { ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ScannerMoverLanes } from "@/components/scanner/scanner-mover-lanes";
import { ThemeProvider } from "@/lib/theme-provider";

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("<ScannerMoverLanes />", () => {
  test("potential lane exposes why-missing quick action", () => {
    const onExplain = vi.fn();
    wrap(
      <ScannerMoverLanes
        gapItems={[
          {
            symbol: "NVDA",
            company_name: "NVIDIA",
            gap_pct: 3.4,
            gap_dollars: 10,
            prev_close: 290,
            current_price: 300,
            volume: 1_200_000,
            volume_vs_avg: 1.8,
            gap_quality_score: 88,
            catalyst: null,
            has_catalyst: false,
            no_catalyst_warning: null
          }
        ]}
        setups={[]}
        nearQualification={[]}
        evaluationTrace={[]}
        onExplainMissingSymbol={onExplain}
      />
    );
    const btn = screen.getByTestId("scanner-potential-why-missing-NVDA");
    fireEvent.click(btn);
    expect(onExplain).toHaveBeenCalledWith("NVDA");
    const link = screen.getByRole("link", { name: "NVDA" });
    expect(link.getAttribute("href")).toContain("/dashboard?symbol=NVDA");
    expect(link.getAttribute("href")).toContain("ref=scanner");
  });
});
