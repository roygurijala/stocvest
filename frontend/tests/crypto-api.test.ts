import { beforeEach, describe, expect, test, vi } from "vitest";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiFetch: apiFetchMock
}));

describe("crypto API overview", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  test("fetchCryptoOverview returns realtime bars and no on-chain metrics", async () => {
    const { fetchCryptoOverview } = await import("@/lib/api/crypto");
    apiFetchMock.mockResolvedValueOnce([
      { symbol: "X:BTCUSD", timestamp: "2026-04-29T19:00:00+00:00", close: 64250.12, volume: 12.5 },
      { symbol: "X:BTCUSD", timestamp: "2026-04-29T19:01:00+00:00", close: 64252.34, volume: 9.8 }
    ]);

    const result = await fetchCryptoOverview("X:BTCUSD");
    expect(result.delayed).toBe(false);
    expect(result.onChainMetricsIncluded).toBe(false);
    expect(result.latestPrice).toBe(64252.34);
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/v1/market/bars?symbol=X%3ABTCUSD&timeframe=1min&limit=30"
    );
  });
});
