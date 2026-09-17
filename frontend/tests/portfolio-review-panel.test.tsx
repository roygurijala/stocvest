import type { ReactElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}));

import {
  benchmarkEdge,
  considerAddSizeLine,
  holdingWhyLine,
  PortfolioReviewPanel
} from "@/components/portfolio/portfolio-review-panel";
import { ThemeProvider } from "@/lib/theme-provider";
import type { PortfolioReview } from "@/lib/portfolio/review-types";
import { PORTFOLIO_REVIEW_SIZING_RULE } from "@/lib/portfolio/review-types";

const fetchMock = vi.fn();
vi.mock("@/lib/api/fetch-portfolio-review-client", () => ({
  fetchPortfolioReviewClient: () => fetchMock()
}));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    })
  });
});

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

function sampleReview(): PortfolioReview {
  return {
    generatedAt: "2026-09-11T20:00:00+00:00",
    holdings: [
      {
        symbol: "AAPL",
        quantity: 10,
        averageCost: 100,
        currentPrice: 120,
        marketValue: 1200,
        unrealizedPl: 200,
        unrealizedPlPct: 20,
        weightPct: 54.5,
        verdict: "bullish",
        confidence: 0.7,
        action: "hold",
        actionLabel: "Hold",
        rationale: ["Long-Term composite reads bullish."],
        overweight: true,
        suggestedAddAmount: null,
        suggestedReduceAmount: 99,
        driverLine: "F2 Growth: Revenue +32% latest-quarter YoY — strong",
        taxLotHint: null,
        longTermLots: 1,
        shortTermLots: 0,
        holderRead: null,
        aiRead: "AAPL AI Investment Read essay that must stay collapsed."
      },
      {
        symbol: "XOM",
        quantity: 5,
        averageCost: 200,
        currentPrice: 150,
        marketValue: 750,
        unrealizedPl: -250,
        unrealizedPlPct: -25,
        weightPct: 34,
        verdict: "bearish",
        confidence: 0.6,
        action: "sell",
        actionLabel: "Sell",
        rationale: ["Long-Term composite reads bearish.", "Holder read: defensive."],
        overweight: false,
        suggestedAddAmount: 150,
        suggestedReduceAmount: null,
        taxLotHint: "All 1 lot(s) are short-term (held ≤ 1 year).",
        longTermLots: 0,
        shortTermLots: 1,
        holderRead: null,
        aiRead: null
      }
    ],
    totalMarketValue: 2200,
    investedValue: 1950,
    cashBalance: 250,
    totalCost: 2000,
    unrealizedPl: -50,
    unrealizedPlPct: -2.5,
    portfolioReturnPct: -2.5,
    concentration: [
      {
        symbol: "AAPL",
        weightPct: 54.5,
        targetPct: 50,
        message: "AAPL is 54.5% of the portfolio, above your 50.0% target."
      }
    ],
    considerAdding: [
      {
        symbol: "NVDA",
        tier: "gem",
        verdict: "bullish",
        why: "cheap + strong",
        sleeve: "core",
        sleeveLowPct: 10,
        sleeveHighPct: 15,
        targetPct: 10,
        suggestedAddAmount: 220,
        driverLine: "F2 Growth: Revenue +18% latest-quarter YoY"
      }
    ],
    benchmark: {
      benchmarkSymbol: "SPY",
      investedCost: 2000,
      benchmarkValue: 2100,
      benchmarkReturnPct: 5,
      note: "Not year-to-date. Same dollars invested in SPY on each of your purchase dates."
    },
    fullyPriced: true,
    effectiveTargetPct: 50,
    targetIsDefault: false,
    sizingRule: PORTFOLIO_REVIEW_SIZING_RULE,
    disclaimer: "Informational review — not advice."
  };
}

describe("PortfolioReviewPanel", () => {
  test("shows an empty prompt before the review is run", () => {
    wrap(<PortfolioReviewPanel />);
    expect(screen.getByTestId("run-review")).toBeInTheDocument();
    expect(screen.getByText(/Run the review/i)).toBeInTheDocument();
  });

  test("renders per-holding actions, concentration, and consider-adding after run", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, review: sampleReview() });
    wrap(<PortfolioReviewPanel />);

    fireEvent.click(screen.getByTestId("run-review"));

    await waitFor(() => expect(screen.getByTestId("review-row-AAPL")).toBeInTheDocument());
    expect(screen.getByTestId("review-deep-dive-AAPL")).toHaveAttribute(
      "href",
      expect.stringContaining("ref=portfolio")
    );
    expect(screen.getByTestId("review-holdings-table")).toBeInTheDocument();
    expect(screen.getByTestId("review-row-XOM")).toBeInTheDocument();
    expect(screen.getByText("Hold")).toBeInTheDocument();
    expect(screen.getByText("Sell")).toBeInTheDocument();
    expect(screen.getByText(/above your 50.0% target/)).toBeInTheDocument();
    expect(screen.getByTestId("consider-add-NVDA")).toHaveTextContent(/NVDA/);
    expect(screen.getByTestId("consider-add-NVDA")).toHaveTextContent(
      /add ~\$220.*core 10–15% sleeve/
    );
    expect(screen.getByTestId("consider-add-NVDA")).toHaveTextContent(/cheap \+ strong/);
    expect(screen.getByTestId("consider-add-driver-NVDA")).toHaveTextContent(
      /F2 Growth: Revenue \+18% latest-quarter YoY/
    );
    expect(screen.getByTestId("review-why-AAPL")).toHaveTextContent(
      /F2 Growth: Revenue \+32% latest-quarter YoY/
    );
    expect(screen.getByText(/SPY on your buy dates/)).toBeInTheDocument();
    expect(screen.getByTestId("benchmark-edge")).toHaveTextContent("behind by 7.5 pts");
    expect(screen.getByTestId("benchmark-note")).toHaveTextContent(
      /Not year-to-date.*same dollars invested in SPY on each of your purchase dates/i
    );
    expect(screen.getAllByText(/vs cost/).length).toBeGreaterThan(0);
    expect(screen.getByText(/add ~\$150/)).toBeInTheDocument();
    expect(screen.getByText(/reduce ~\$99/)).toBeInTheDocument();
    expect(screen.getByTestId("review-do-this-AAPL")).toHaveTextContent(/reduce ~\$99/);
    expect(screen.queryByText(/AAPL AI Investment Read essay/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("holder-read-AAPL")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-read-AAPL")).not.toBeInTheDocument();
    expect(screen.queryByTestId("review-row-detail-AAPL")).not.toBeInTheDocument();
    expect(screen.queryByTestId("review-default-target")).not.toBeInTheDocument();
    expect(screen.getByTestId("review-sizing-rule")).toHaveTextContent(
      /Sell still reduces the full position/
    );
  });

  test("keeps sizing copy in the expand when Why is the signal driver", async () => {
    const review = sampleReview();
    review.holdings[0].sizingReason = "Trim the excess above the core 15% sleeve high.";
    fetchMock.mockResolvedValueOnce({ ok: true, review });
    wrap(<PortfolioReviewPanel />);

    fireEvent.click(screen.getByTestId("run-review"));

    await waitFor(() => expect(screen.getByTestId("review-why-AAPL")).toBeInTheDocument());
    expect(screen.getByTestId("review-why-AAPL")).toHaveTextContent(/F2 Growth/);
    expect(screen.queryByText(/Trim the excess above the core/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("review-row-AAPL"));

    expect(screen.getByTestId("review-row-detail-AAPL")).toHaveTextContent(
      /Trim the excess above the core 15% sleeve high/
    );
  });

  test("shows a sell-under-target reason under the reduce badge", async () => {
    const review = sampleReview();
    review.holdings = [
      {
        ...review.holdings[1],
        symbol: "ARKQ",
        action: "sell",
        actionLabel: "Sell",
        weightPct: 4.2,
        suggestedAddAmount: null,
        suggestedReduceAmount: 7100,
        sizingReason:
          "Sell overrides the target: reducing the full position even though weight is below the ~9.1% target."
      }
    ];
    fetchMock.mockResolvedValueOnce({ ok: true, review });
    wrap(<PortfolioReviewPanel />);

    fireEvent.click(screen.getByTestId("run-review"));

    await waitFor(() => expect(screen.getByTestId("review-row-ARKQ")).toBeInTheDocument());
    expect(screen.getByText(/reduce ~\$7,100/)).toBeInTheDocument();
    expect(screen.getByTestId("sizing-reason-ARKQ")).toHaveTextContent(
      /Sell overrides the target: reducing the full position even though weight is below the ~9\.1% target/
    );
    expect(screen.getByTestId("review-sizing-rule")).toHaveTextContent(
      /Hold \+ caution does not add/
    );
  });

  test("shows a muted sleeve-policy line when the review uses conviction sleeves", async () => {
    const review = sampleReview();
    review.effectiveTargetPct = null;
    review.targetIsDefault = true;
    review.sizingPolicy = "sleeve";
    fetchMock.mockResolvedValueOnce({ ok: true, review });
    wrap(<PortfolioReviewPanel />);

    fireEvent.click(screen.getByTestId("run-review"));

    await waitFor(() => expect(screen.getByTestId("review-default-target")).toBeInTheDocument());
    expect(screen.getByTestId("review-default-target")).toHaveTextContent(
      /Using conviction sleeves/
    );
    expect(screen.getByTestId("review-default-target")).toHaveTextContent(/core 10–15%/);
  });

  test("shows an error when the review cannot be fetched", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 504,
      message: "Could not run the review right now. Please try again."
    });
    wrap(<PortfolioReviewPanel />);

    fireEvent.click(screen.getByTestId("run-review"));

    await waitFor(() =>
      expect(screen.getByText(/Could not run the review/i)).toBeInTheDocument()
    );
  });

  test("renders holder-read guidance when present", async () => {
    const review = sampleReview();
    review.holdings[0].holderRead = {
      stance: "constructive",
      headline: "Keep holding — trend intact",
      actions: ["Add on a pullback to support"]
    };
    fetchMock.mockResolvedValueOnce({ ok: true, review });
    wrap(<PortfolioReviewPanel />);

    fireEvent.click(screen.getByTestId("run-review"));

    await waitFor(() => expect(screen.getByTestId("review-row-AAPL")).toBeInTheDocument());
    expect(screen.queryByTestId("holder-read-AAPL")).not.toBeInTheDocument();
    expect(screen.queryByText(/Keep holding — trend intact/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("review-row-AAPL"));

    expect(screen.getByTestId("holder-read-AAPL")).toBeInTheDocument();
    expect(screen.getByText(/Keep holding — trend intact/)).toBeInTheDocument();
    expect(screen.getByText(/Add on a pullback/)).toBeInTheDocument();
    expect(screen.getByTestId("ai-read-AAPL")).toHaveTextContent(
      /AAPL AI Investment Read essay that must stay collapsed/
    );
  });

  test("shows a vehicle honesty banner for fund/ETF holdings", async () => {
    const review = sampleReview();
    review.holdings[0].symbol = "IBIT";
    review.holdings[0].isFundVehicle = true;
    fetchMock.mockResolvedValueOnce({ ok: true, review });
    wrap(<PortfolioReviewPanel />);

    fireEvent.click(screen.getByTestId("run-review"));

    await waitFor(() => expect(screen.getByTestId("review-row-IBIT")).toBeInTheDocument());
    expect(screen.queryByTestId("vehicle-honesty-IBIT")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("review-row-IBIT"));

    expect(screen.getByTestId("vehicle-honesty-IBIT")).toBeInTheDocument();
    expect(screen.getByText(/Fund\/ETF vehicle — no corporate filings/i)).toBeInTheDocument();
  });

  test("shows an empty-holdings message when the review has no holdings", async () => {
    const review = sampleReview();
    review.holdings = [];
    fetchMock.mockResolvedValueOnce({ ok: true, review });
    wrap(<PortfolioReviewPanel />);

    fireEvent.click(screen.getByTestId("run-review"));

    await waitFor(() =>
      expect(screen.getByText(/No holdings to review yet/i)).toBeInTheDocument()
    );
  });
});

describe("holdingWhyLine", () => {
  test("prefers the signal driver over sizing copy", () => {
    expect(
      holdingWhyLine({
        symbol: "OVV",
        quantity: 0,
        averageCost: null,
        currentPrice: null,
        marketValue: null,
        unrealizedPl: null,
        unrealizedPlPct: null,
        weightPct: null,
        verdict: "bullish",
        confidence: null,
        action: "buy_more",
        actionLabel: "Buy more",
        rationale: ["Long-Term composite reads bullish."],
        overweight: false,
        suggestedAddAmount: 420,
        suggestedReduceAmount: null,
        sizingReason: "Starter at core 10–15% sleeve — add ~$420.00 to reach the 10.0% floor.",
        driverLine: "F2 Growth: Revenue +18% latest-quarter YoY",
        taxLotHint: null,
        longTermLots: 0,
        shortTermLots: 0,
        holderRead: null,
        aiRead: null
      })
    ).toBe("F2 Growth: Revenue +18% latest-quarter YoY");
  });

  test("falls back to sizing when the driver is missing", () => {
    expect(
      holdingWhyLine({
        symbol: "ARKQ",
        quantity: 1,
        averageCost: 50,
        currentPrice: 40,
        marketValue: 40,
        unrealizedPl: -10,
        unrealizedPlPct: -20,
        weightPct: 4.2,
        verdict: "bearish",
        confidence: null,
        action: "sell",
        actionLabel: "Sell",
        rationale: ["Long-Term composite reads bearish."],
        overweight: false,
        suggestedAddAmount: null,
        suggestedReduceAmount: 7100,
        sizingReason: "Sell overrides the target: reducing the full position.",
        taxLotHint: null,
        longTermLots: 0,
        shortTermLots: 1,
        holderRead: null,
        aiRead: null
      })
    ).toMatch(/Sell overrides the target/);
  });
});

describe("considerAddSizeLine", () => {
  test("names the sleeve percent and the cash-capped dollars", () => {
    expect(
      considerAddSizeLine({
        symbol: "OVV",
        tier: "gem",
        verdict: "bullish",
        why: "growth-led",
        sleeve: "core",
        sleeveLowPct: 10,
        sleeveHighPct: 15,
        targetPct: 10,
        suggestedAddAmount: 1240
      })
    ).toMatch(/add ~\$1,240.*core 10–15% sleeve/);
  });

  test("when cash is gone, still names the percent of the book", () => {
    expect(
      considerAddSizeLine(
        {
          symbol: "OVV",
          tier: "gem",
          verdict: "bullish",
          why: "growth-led",
          sleeve: "core",
          sleeveLowPct: 10,
          sleeveHighPct: 15,
          targetPct: 10,
          suggestedAddAmount: 0
        },
        20_000
      )
    ).toMatch(/core 10–15% sleeve is ~\$2,000.*no cash left/i);
  });
});

describe("benchmarkEdge", () => {
  test("says how far ahead the book is", () => {
    expect(benchmarkEdge(26.1, 23.4)).toEqual({ label: "ahead by 2.7 pts", ahead: true });
  });

  test("says how far behind the book is", () => {
    expect(benchmarkEdge(-2.5, 5)).toEqual({ label: "behind by 7.5 pts", ahead: false });
  });

  test("calls a near-tie dead even with no direction", () => {
    expect(benchmarkEdge(12.01, 12)).toEqual({ label: "dead even", ahead: null });
  });

  test("stays silent when either side is missing", () => {
    expect(benchmarkEdge(12, null)).toBeNull();
    expect(benchmarkEdge(null, 12)).toBeNull();
  });
});
