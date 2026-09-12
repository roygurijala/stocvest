import type { ReactElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";

import { PortfolioReviewPanel } from "@/components/portfolio/portfolio-review-panel";
import { ThemeProvider } from "@/lib/theme-provider";
import type { PortfolioReview } from "@/lib/portfolio/review-types";

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
        suggestedReduceAmount: null,
        taxLotHint: null,
        longTermLots: 1,
        shortTermLots: 0,
        holderRead: null,
        aiRead: null
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
        suggestedAddAmount: null,
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
    considerAdding: [{ symbol: "NVDA", tier: "gem", verdict: "bullish", why: "cheap + strong" }],
    benchmark: {
      benchmarkSymbol: "SPY",
      investedCost: 2000,
      benchmarkValue: 2100,
      benchmarkReturnPct: 5,
      note: "Money-weighted."
    },
    fullyPriced: true,
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
    fetchMock.mockResolvedValueOnce(sampleReview());
    wrap(<PortfolioReviewPanel />);

    fireEvent.click(screen.getByTestId("run-review"));

    await waitFor(() => expect(screen.getByTestId("review-row-AAPL")).toBeInTheDocument());
    expect(screen.getByTestId("review-row-XOM")).toBeInTheDocument();
    expect(screen.getByText("Hold")).toBeInTheDocument();
    expect(screen.getByText("Sell")).toBeInTheDocument();
    expect(screen.getByText(/above your 50.0% target/)).toBeInTheDocument();
    expect(screen.getByText(/NVDA/)).toBeInTheDocument();
    expect(screen.getByText(/SPY \(money-weighted\)/)).toBeInTheDocument();
  });

  test("shows an error when the review cannot be fetched", async () => {
    fetchMock.mockResolvedValueOnce(null);
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
    fetchMock.mockResolvedValueOnce(review);
    wrap(<PortfolioReviewPanel />);

    fireEvent.click(screen.getByTestId("run-review"));

    await waitFor(() => expect(screen.getByTestId("holder-read-AAPL")).toBeInTheDocument());
    expect(screen.getByText(/Keep holding — trend intact/)).toBeInTheDocument();
    expect(screen.getByText(/Add on a pullback/)).toBeInTheDocument();
  });

  test("shows an empty-holdings message when the review has no holdings", async () => {
    const review = sampleReview();
    review.holdings = [];
    fetchMock.mockResolvedValueOnce(review);
    wrap(<PortfolioReviewPanel />);

    fireEvent.click(screen.getByTestId("run-review"));

    await waitFor(() =>
      expect(screen.getByText(/No holdings to review yet/i)).toBeInTheDocument()
    );
  });
});
