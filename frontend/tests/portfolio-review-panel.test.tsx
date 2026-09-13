import type { ReactElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";

import { PortfolioReviewPanel } from "@/components/portfolio/portfolio-review-panel";
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
    considerAdding: [{ symbol: "NVDA", tier: "gem", verdict: "bullish", why: "cheap + strong" }],
    benchmark: {
      benchmarkSymbol: "SPY",
      investedCost: 2000,
      benchmarkValue: 2100,
      benchmarkReturnPct: 5,
      note: "Money-weighted."
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
    expect(screen.getByTestId("review-row-XOM")).toBeInTheDocument();
    expect(screen.getByText("Hold")).toBeInTheDocument();
    expect(screen.getByText("Sell")).toBeInTheDocument();
    expect(screen.getByText(/above your 50.0% target/)).toBeInTheDocument();
    expect(screen.getByText(/NVDA/)).toBeInTheDocument();
    expect(screen.getByText(/SPY \(money-weighted\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/vs cost/).length).toBeGreaterThan(0);
    expect(screen.getByText(/add ~\$150/)).toBeInTheDocument();
    expect(screen.getByText(/reduce ~\$99/)).toBeInTheDocument();
    expect(screen.queryByTestId("review-default-target")).not.toBeInTheDocument();
    expect(screen.getByTestId("review-sizing-rule")).toHaveTextContent(
      /If the verdict is Sell, reduce the position even when it is below target/
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
      /If Hold\/Neutral and caution, do not add toward target/
    );
  });

  test("shows a muted default-target line when the review uses the personal default", async () => {
    const review = sampleReview();
    review.effectiveTargetPct = 9.0909;
    review.targetIsDefault = true;
    fetchMock.mockResolvedValueOnce({ ok: true, review });
    wrap(<PortfolioReviewPanel />);

    fireEvent.click(screen.getByTestId("run-review"));

    await waitFor(() => expect(screen.getByTestId("review-default-target")).toBeInTheDocument());
    expect(screen.getByText(/Using default ~9.1% target \(8-name floor\)/)).toBeInTheDocument();
    expect(screen.getByText(/changeable in Portfolio settings/)).toBeInTheDocument();
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

    await waitFor(() => expect(screen.getByTestId("holder-read-AAPL")).toBeInTheDocument());
    expect(screen.getByText(/Keep holding — trend intact/)).toBeInTheDocument();
    expect(screen.getByText(/Add on a pullback/)).toBeInTheDocument();
  });

  test("shows a vehicle honesty banner for fund/ETF holdings", async () => {
    const review = sampleReview();
    review.holdings[0].symbol = "IBIT";
    review.holdings[0].isFundVehicle = true;
    fetchMock.mockResolvedValueOnce({ ok: true, review });
    wrap(<PortfolioReviewPanel />);

    fireEvent.click(screen.getByTestId("run-review"));

    await waitFor(() => expect(screen.getByTestId("vehicle-honesty-IBIT")).toBeInTheDocument());
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
