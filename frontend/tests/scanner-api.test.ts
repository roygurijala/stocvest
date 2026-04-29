import { beforeEach, describe, expect, test, vi } from "vitest";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiFetch: apiFetchMock
}));

describe("scanner API overview", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  test("fetchScannerOverview orchestrates scanner endpoints", async () => {
    const { fetchScannerOverview } = await import("@/lib/api/scanner");
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/v1/market/snapshot?symbol=")) {
        return {
          symbol: "AAPL",
          prev_close: 100,
          pre_market_price: 104,
          day_volume: 1_000_000
        };
      }
      if (path === "/v1/market/news?limit=20") {
        return [
          {
            article_id: "a1",
            published_at: "2026-04-29T10:00:00+00:00",
            title: "News",
            url: "https://example.com",
            tickers: ["AAPL"],
            keywords: [],
            sentiment: "bullish",
            sentiment_score: 0.7
          }
        ];
      }
      if (path.includes("/v1/market/bars?")) {
        return [
          {
            timestamp: "2026-04-29T10:00:00+00:00",
            timeframe: "1min",
            open: 100,
            high: 101,
            low: 99,
            close: 100.5,
            volume: 120000
          }
        ];
      }
      if (path === "/v1/scanner/gaps") {
        return [{ symbol: "GAP1", gap_percent: 4, day_volume: 1, rank_score: 1, direction: "up" }];
      }
      if (path === "/v1/scanner/catalysts") {
        return [{ article_id: "a1", symbol: "GAP1", title: "x", catalyst_type: "earnings", direction: "up", catalyst_score: 0.8 }];
      }
      if (path === "/v1/scanner/intraday") {
        return [{ symbol: "GAP1", direction: "long", score: 0.7, triggers: [], timestamp_iso: "x" }];
      }
      if (path === "/v1/scanner/briefing") {
        return { date_iso: "2026-04-29", title: "Briefing", markdown: "ok" };
      }
      throw new Error(`Unhandled path ${path}`);
    });

    const result = await fetchScannerOverview(null);
    expect(result.error).toBeUndefined();
    expect(result.gaps).toHaveLength(1);
    expect(result.briefing?.title).toBe("Briefing");
  });

  test("fetchScannerOverview handles scanner failures", async () => {
    const { fetchScannerOverview } = await import("@/lib/api/scanner");
    apiFetchMock.mockRejectedValueOnce(new Error("API request failed (500): scanner"));
    const result = await fetchScannerOverview(null);
    expect(result.error).toContain("500");
    expect(result.gaps).toHaveLength(0);
  });
});
