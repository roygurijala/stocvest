import { afterEach, describe, expect, test, vi } from "vitest";

import { fetchPortfolioReviewClient } from "@/lib/api/fetch-portfolio-review-client";
import type { PortfolioReview } from "@/lib/portfolio/review-types";

function sampleReview(): PortfolioReview {
  return {
    generatedAt: "2026-09-12T20:00:00+00:00",
    holdings: [],
    totalMarketValue: 0,
    investedValue: 0,
    cashBalance: 0,
    totalCost: 0,
    unrealizedPl: null,
    unrealizedPlPct: null,
    portfolioReturnPct: null,
    concentration: [],
    considerAdding: [],
    benchmark: null,
    fullyPriced: true,
    disclaimer: "Informational review — not advice."
  };
}

describe("fetchPortfolioReviewClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("returns a review when refresh responds immediately", async () => {
    const review = sampleReview();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => review
      })
    );

    const result = await fetchPortfolioReviewClient();
    expect(result).toEqual({ ok: true, review });
    expect(fetch).toHaveBeenCalledWith(
      "/api/stocvest/portfolio-review?refresh=1",
      expect.objectContaining({ method: "GET" })
    );
  });

  test("kicks refresh then polls until the review is cached", async () => {
    vi.useFakeTimers();
    const review = sampleReview();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ pending: true, cached: false })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ pending: true, cached: false })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => review
      });
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchPortfolioReviewClient();
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result).toEqual({ ok: true, review });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/stocvest/portfolio-review?refresh=1");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/stocvest/portfolio-review");
  });

  test("surfaces HTTP 403 instead of a generic failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: "forbidden" })
      })
    );

    const result = await fetchPortfolioReviewClient();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.status).toBe(403);
    expect(result.message).toMatch(/HTTP 403/);
    expect(result.message).toMatch(/isn't available/);
  });

  test("explains a gateway timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 504,
        json: async () => ({})
      })
    );

    const result = await fetchPortfolioReviewClient();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.status).toBe(504);
    expect(result.message).toMatch(/timed out/i);
  });
});
