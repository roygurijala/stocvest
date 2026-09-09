import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Force the feature flag on for the render tests.
vi.mock("@/lib/nav-features", () => ({ positionResearchEnabled: () => true }));

import {
  PositionResearchPanel,
  formatXbrlValue
} from "@/components/dashboard/trading-room/position-research-panel";
import { colorTokens } from "@/lib/design-system";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("formatXbrlValue", () => {
  it("formats USD magnitudes compactly and EPS as dollars", () => {
    expect(formatXbrlValue(383_000_000_000, "USD")).toBe("$383.00B");
    expect(formatXbrlValue(1_500_000_000_000, "USD")).toBe("$1.50T");
    expect(formatXbrlValue(97_000_000, "USD")).toBe("$97.0M");
    expect(formatXbrlValue(-2_000_000_000, "USD")).toBe("-$2.00B");
    expect(formatXbrlValue(6.13, "USD/shares")).toBe("$6.13");
    expect(formatXbrlValue(-1.5, "USD/shares")).toBe("-$1.50"); // diluted loss per share
    expect(formatXbrlValue(12345, "USD")).toBe("$12,345");
    expect(formatXbrlValue(Number.NaN, "USD")).toBe("—");
    expect(formatXbrlValue(Number.POSITIVE_INFINITY, "USD")).toBe("—");
  });
});

function okResponse() {
  return {
    status: "ok",
    recent_developments: null,
    risk_factors: null,
    financials: {
      entity_name: "Apple Inc.",
      scored: false,
      source_url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=10-K",
      facts: [
        { key: "revenue", label: "Revenue", value: 383_000_000_000, unit: "USD", fiscal_year: 2024, period_end: "2024-09-28", form: "10-K", filed: "2024-11-01" },
        { key: "diluted_eps", label: "Diluted EPS", value: 6.13, unit: "USD/shares", fiscal_year: 2024, period_end: "2024-09-28", form: "10-K", filed: "2024-11-01" }
      ]
    },
    disclaimer: "External research shown for context only — not part of the STOCVEST signal."
  };
}

describe("PositionResearchPanel — SEC financials", () => {
  it("renders the SEC financials table on load", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => okResponse() }) as unknown as typeof fetch;

    render(<PositionResearchPanel symbol="AAPL" colors={colorTokens.dark} />);
    fireEvent.click(screen.getByTestId("position-research-load"));

    await waitFor(() => expect(screen.getByTestId("position-research-financials")).toBeTruthy());
    expect(screen.getByTestId("position-research-fact-revenue")).toBeTruthy();
    expect(screen.getByText("$383.00B")).toBeTruthy();
    expect(screen.getByText("$6.13")).toBeTruthy();
    // never-scored framing is present (badge appears for each external block)
    expect(screen.getAllByText(/not scored/i).length).toBeGreaterThan(0);
  });

  it("omits the financials block when the payload has none", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ...okResponse(), financials: null }) }) as unknown as typeof fetch;

    render(<PositionResearchPanel symbol="AAPL" colors={colorTokens.dark} />);
    fireEvent.click(screen.getByTestId("position-research-load"));

    await waitFor(() => expect(screen.queryByTestId("position-research-financials")).toBeNull());
  });
});
