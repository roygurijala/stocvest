import { describe, expect, test } from "vitest";

describe("multi-broker portfolio overview", () => {
  test("derives summaries from broker overview and keeps disconnected broker visible", async () => {
    const { fetchPortfolioOverview } = await import("@/lib/api/portfolio");
    const brokerOverviews = [
      {
        broker: "mock",
        accounts: [{ account_id: "A1" }],
        positionsByAccount: { A1: [{ symbol: "AAPL", quantity: 2, avg_cost: 100 }] }
      },
      {
        broker: "ibkr",
        accounts: [],
        positionsByAccount: {},
        error: "API request failed (503): unavailable"
      }
    ] as any;

    const result = await fetchPortfolioOverview(brokerOverviews);
    expect(result.accounts).toHaveLength(2);
    const mockCard = result.accounts.find((x) => x.broker === "mock");
    const ibkrCard = result.accounts.find((x) => x.broker === "ibkr");
    expect(mockCard?.summary?.gross_exposure).toBe(200);
    expect(ibkrCard?.error).toContain("503");
  });
});
