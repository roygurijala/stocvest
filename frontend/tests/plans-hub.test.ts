import { describe, expect, it } from "vitest";
import { dashboardDeepLinkForPlan } from "@/lib/trade-plan/plans-hub-deeplink";
import { feedCardTrackedPlanKey, trackedPlanKey } from "@/lib/trade-plan/tracked-plan-key";

describe("plans-hub-deeplink", () => {
  it("builds trading room deep link with lane and ref", () => {
    expect(dashboardDeepLinkForPlan("aapl", "swing")).toBe(
      "/dashboard?symbol=AAPL&lane=swing&ref=trade-plans"
    );
    expect(dashboardDeepLinkForPlan("MSFT", "day")).toBe(
      "/dashboard?symbol=MSFT&lane=day&ref=trade-plans"
    );
  });
});

describe("tracked-plan-key", () => {
  it("normalizes symbol in plan keys", () => {
    expect(trackedPlanKey(" nvda ", "day")).toBe("day:NVDA");
    expect(feedCardTrackedPlanKey({ symbol: "TSLA", lane: "swing" })).toBe("swing:TSLA");
  });
});
