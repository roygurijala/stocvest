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

  it("renders the SEC↔provider cross-check with a differing line", async () => {
    const payload = {
      ...okResponse(),
      financials_crosscheck: {
        provider: "FMP",
        disagreements: 1,
        comparable: 2,
        scored: false,
        rows: [
          { key: "revenue", label: "Revenue", unit: "USD", fiscal_year: 2024, sec_value: 383e9, provider_value: 300e9, rel_diff: 0.2167, agrees: false, note: "differs 21.7% (SEC vs FMP)" },
          { key: "diluted_eps", label: "Diluted EPS", unit: "USD/shares", fiscal_year: 2024, sec_value: 6.13, provider_value: 6.1, rel_diff: 0.0049, agrees: true, note: "within tolerance" },
          { key: "net_income", label: "Net income", unit: "USD", fiscal_year: 2024, sec_value: 95e9, provider_value: null, rel_diff: null, agrees: null, note: "FMP FY2024 missing this line" }
        ]
      }
    };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => payload }) as unknown as typeof fetch;

    render(<PositionResearchPanel symbol="AAPL" colors={colorTokens.dark} />);
    fireEvent.click(screen.getByTestId("position-research-load"));

    await waitFor(() => expect(screen.getByTestId("position-research-crosscheck")).toBeTruthy());
    // comparable rows render; the not-comparable (net_income) row is filtered out.
    expect(screen.getByTestId("position-research-crosscheck-revenue")).toBeTruthy();
    expect(screen.getByTestId("position-research-crosscheck-diluted_eps")).toBeTruthy();
    expect(screen.queryByTestId("position-research-crosscheck-net_income")).toBeNull();
    expect(screen.getByText(/1 line\(s\) differ/i)).toBeTruthy();
    expect(screen.getByText(/differs 21\.7%/i)).toBeTruthy();
  });

  it("renders the 10-K filings digest passages when present", async () => {
    const payload = {
      ...okResponse(),
      filings_digest: {
        symbol: "AAPL",
        source_url: "https://www.sec.gov/x/aapl-10k.htm",
        filing_date: "2025-10-30",
        form: "10-K",
        scored: false,
        passages: [
          { text: "Services revenue drove growth across the installed base.", section_label: "Item 7 · MD&A", source_url: "https://www.sec.gov/x/aapl-10k.htm", score: 1.23 },
          { text: "Supply chain concentration is a key risk.", section_label: "Item 1A · Risk Factors", source_url: "https://www.sec.gov/x/aapl-10k.htm", score: 1.01 }
        ]
      }
    };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => payload }) as unknown as typeof fetch;

    render(<PositionResearchPanel symbol="AAPL" colors={colorTokens.dark} />);
    fireEvent.click(screen.getByTestId("position-research-load"));

    await waitFor(() => expect(screen.getByTestId("position-research-filings")).toBeTruthy());
    expect(screen.getAllByTestId("position-research-filing-passage").length).toBe(2);
    expect(screen.getByText(/Services revenue drove growth/i)).toBeTruthy();
    expect(screen.getByText("Item 1A · Risk Factors")).toBeTruthy();
  });

  it("omits the filings digest when it has no passages", async () => {
    const payload = { ...okResponse(), filings_digest: { symbol: "AAPL", source_url: "", filing_date: "", form: "10-K", scored: false, passages: [] } };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => payload }) as unknown as typeof fetch;

    render(<PositionResearchPanel symbol="AAPL" colors={colorTokens.dark} />);
    fireEvent.click(screen.getByTestId("position-research-load"));

    await waitFor(() => expect(screen.getByTestId("position-research-financials")).toBeTruthy());
    expect(screen.queryByTestId("position-research-filings")).toBeNull();
  });

  it("omits the cross-check block when none is comparable", async () => {
    const payload = {
      ...okResponse(),
      financials_crosscheck: {
        provider: "FMP",
        disagreements: 0,
        comparable: 0,
        scored: false,
        rows: [
          { key: "revenue", label: "Revenue", unit: "USD", fiscal_year: 2024, sec_value: 383e9, provider_value: null, rel_diff: null, agrees: null, note: "No FMP FY2024 value to compare" }
        ]
      }
    };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => payload }) as unknown as typeof fetch;

    render(<PositionResearchPanel symbol="AAPL" colors={colorTokens.dark} />);
    fireEvent.click(screen.getByTestId("position-research-load"));

    await waitFor(() => expect(screen.getByTestId("position-research-financials")).toBeTruthy());
    expect(screen.queryByTestId("position-research-crosscheck")).toBeNull();
  });
});
