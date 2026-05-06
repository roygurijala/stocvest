import { beforeEach, describe, expect, test, vi } from "vitest";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiFetch: apiFetchMock
}));

describe("market API overview fetch", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  test("fetchMarketOverview orchestrates status/snapshots/sparklines", async () => {
    const { fetchMarketOverview } = await import("@/lib/api/market");
    apiFetchMock.mockResolvedValueOnce({
      market: "open",
      exchanges: { nyse: "open" },
      currencies: { usd: "open" }
    });
    apiFetchMock.mockResolvedValueOnce({
      snapshots: [
        { symbol: "SPY", last_trade_price: 501.2 },
        { symbol: "QQQ", last_trade_price: 432.1 }
      ]
    });
    apiFetchMock.mockResolvedValueOnce({
      bars_by_symbol: {
        SPY: [{ close: 500 }, { close: 501 }],
        QQQ: [{ close: 430 }, { close: 432 }]
      }
    });

    const result = await fetchMarketOverview(["SPY", "QQQ"]);
    expect(result.error).toBeUndefined();
    expect(result.status?.market).toBe("open");
    expect(result.snapshots).toHaveLength(2);
    expect(result.news).toHaveLength(0);
    expect(result.sparklinesBySymbol?.SPY?.length).toBeGreaterThan(0);
    expect(result.sparklinesBySymbol?.QQQ?.length).toBeGreaterThan(0);
  });

  test("fetchMarketOverview handles API errors", async () => {
    const { fetchMarketOverview } = await import("@/lib/api/market");
    apiFetchMock.mockRejectedValue(new Error("API request failed (500): boom"));
    const result = await fetchMarketOverview();
    expect(result.error).toMatch(/500/);
    expect(result.snapshots).toHaveLength(0);
  });
});
