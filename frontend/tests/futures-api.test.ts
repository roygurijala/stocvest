import { beforeEach, describe, expect, test, vi } from "vitest";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiFetch: apiFetchMock
}));

describe("IBKR futures dashboard API", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  test("returns connected overview when TWS is healthy", async () => {
    const { fetchIbkrFuturesOverview } = await import("@/lib/api/futures");
    apiFetchMock.mockResolvedValueOnce({ broker: "ibkr", ok: true, message: "ok" });
    apiFetchMock.mockResolvedValueOnce([{ account_id: "DU123", display_name: "Paper" }]);
    apiFetchMock.mockResolvedValueOnce([{ symbol: "ESM6", quantity: 1, avg_cost: 5230.5 }]);

    const result = await fetchIbkrFuturesOverview();
    expect(result.connected).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.positionsByAccount["DU123"][0].symbol).toBe("ESM6");
  });

  test("returns graceful disconnected status when TWS is unavailable", async () => {
    const { fetchIbkrFuturesOverview } = await import("@/lib/api/futures");
    apiFetchMock.mockRejectedValueOnce(new Error("API request failed (503): unavailable"));

    const result = await fetchIbkrFuturesOverview();
    expect(result.connected).toBe(false);
    expect(result.statusMessage).toContain("unavailable");
    expect(result.accounts).toHaveLength(0);
  });
});
