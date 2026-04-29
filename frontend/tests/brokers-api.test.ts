import { beforeEach, describe, expect, test, vi } from "vitest";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiFetch: apiFetchMock
}));

describe("broker API overview fetch", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  test("fetchBrokerOverview returns accounts and positions", async () => {
    const { fetchBrokerOverview } = await import("@/lib/api/brokers");

    apiFetchMock.mockResolvedValueOnce({
      broker: "mock",
      health: { broker: "mock", ok: true },
      accounts: [{ account_id: "acct-1", display_name: "Main" }],
      positions_by_account: { "acct-1": [{ symbol: "AAPL", quantity: 2 }] }
    });

    const result = await fetchBrokerOverview("mock");
    expect(result.error).toBeUndefined();
    expect(result.health?.ok).toBe(true);
    expect(result.accounts?.length).toBe(1);
    expect(result.positionsByAccount["acct-1"]).toHaveLength(1);
    expect(apiFetchMock).toHaveBeenCalledWith("/v1/brokers/overview?broker=mock");
  });

  test("fetchBrokerOverview captures API errors", async () => {
    const { fetchBrokerOverview } = await import("@/lib/api/brokers");

    apiFetchMock.mockRejectedValueOnce(new Error("API request failed (503): unavailable"));
    const result = await fetchBrokerOverview("ibkr");

    expect(result.broker).toBe("ibkr");
    expect(result.error).toContain("503");
  });

  test("placeBrokerOrder sends expected endpoint and payload", async () => {
    const { placeBrokerOrder } = await import("@/lib/api/brokers");
    apiFetchMock.mockResolvedValueOnce({ client_order_id: "web-1", broker_order_id: "b-1" });

    const payload = {
      symbol: "SPY",
      side: "buy" as const,
      quantity: 1,
      order_type: "market" as const,
      time_in_force: "day" as const,
      client_order_id: "web-1"
    };
    const result = await placeBrokerOrder("mock", "acct-1", payload);

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/v1/brokers/orders?broker=mock&account_id=acct-1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload)
      })
    );
    expect(result.client_order_id).toBe("web-1");
  });
});
