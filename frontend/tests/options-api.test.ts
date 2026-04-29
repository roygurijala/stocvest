import { beforeEach, describe, expect, test, vi } from "vitest";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiFetch: apiFetchMock
}));

describe("options API overview", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  test("fetchOptionChainOverview requests options endpoint and includes delay metadata", async () => {
    const { fetchOptionChainOverview } = await import("@/lib/api/options");
    apiFetchMock.mockResolvedValueOnce([
      {
        symbol: "O:AAPL260620C00100000",
        underlying: "AAPL",
        expiration: "2026-06-20T00:00:00+00:00",
        strike: 100,
        option_type: "call",
        delta: 0.52,
        gamma: 0.03,
        theta: -0.02,
        vega: 0.11
      }
    ]);
    const result = await fetchOptionChainOverview("AAPL");
    expect(apiFetchMock).toHaveBeenCalledWith("/v1/market/options?symbol=AAPL&limit=30");
    expect(result.delayedByMinutes).toBe(15);
    expect(result.rows[0].delta).toBe(0.52);
  });
});
