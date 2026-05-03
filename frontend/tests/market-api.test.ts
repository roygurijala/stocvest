import { beforeEach, describe, expect, test, vi } from "vitest";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiFetch: apiFetchMock
}));

describe("market API overview fetch", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  test("fetchMarketOverview orchestrates status/snapshots/news", async () => {
    const { fetchMarketOverview } = await import("@/lib/api/market");
    apiFetchMock.mockResolvedValueOnce({
      market: "open",
      exchanges: { nyse: "open" },
      currencies: { usd: "open" }
    });
    apiFetchMock.mockResolvedValueOnce([{ article_id: "n1", title: "Headline", tickers: [], published_at: "x", url: "u" }]);
    apiFetchMock.mockResolvedValueOnce({ symbol: "SPY", last_trade_price: 501.2 });
    apiFetchMock.mockResolvedValueOnce({ symbol: "QQQ", last_trade_price: 432.1 });
    apiFetchMock.mockResolvedValueOnce([{ close: 500 }, { close: 501 }]);
    apiFetchMock.mockResolvedValueOnce([{ close: 430 }, { close: 432 }]);

    const result = await fetchMarketOverview(["SPY", "QQQ"]);
    expect(result.error).toBeUndefined();
    expect(result.status?.market).toBe("open");
    expect(result.snapshots).toHaveLength(2);
    expect(result.news).toHaveLength(1);
    expect(result.sparklinesBySymbol?.SPY?.length).toBeGreaterThan(0);
    expect(result.sparklinesBySymbol?.QQQ?.length).toBeGreaterThan(0);
  });

  test("fetchMarketOverview handles API errors", async () => {
    const { fetchMarketOverview } = await import("@/lib/api/market");
    apiFetchMock.mockRejectedValueOnce(new Error("API request failed (500): boom"));
    const result = await fetchMarketOverview();
    expect(result.error).toContain("500");
    expect(result.snapshots).toHaveLength(0);
  });
});
