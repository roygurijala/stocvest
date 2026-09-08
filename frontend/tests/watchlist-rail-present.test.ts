import { describe, expect, it } from "vitest";
import {
  watchlistHeatShowsStateBadge,
  watchlistHeatStateBadgeLabel,
  watchlistSessionChangePct
} from "@/lib/dashboard/trading-room/watchlist-rail-present";

describe("watchlist-rail-present (ADR-003 UX-D7)", () => {
  it("shows badges only for actionable and near", () => {
    expect(watchlistHeatShowsStateBadge("actionable")).toBe(true);
    expect(watchlistHeatShowsStateBadge("near")).toBe(true);
    expect(watchlistHeatShowsStateBadge("potential")).toBe(false);
    expect(watchlistHeatShowsStateBadge("cooling")).toBe(false);
  });

  it("maps badge labels", () => {
    expect(watchlistHeatStateBadgeLabel("actionable")).toBe("Actionable");
    expect(watchlistHeatStateBadgeLabel("near")).toBe("Near");
    expect(watchlistHeatStateBadgeLabel("potential")).toBeNull();
  });

  it("derives session change from last trade and prior close when change_percent is missing", () => {
    expect(
      watchlistSessionChangePct({
        symbol: "NVDA",
        last_trade_price: 110,
        prev_close: 100
      })
    ).toBeCloseTo(10, 5);
    expect(
      watchlistSessionChangePct({
        symbol: "NVDA",
        pre_market_change_percent: 1.5
      })
    ).toBe(1.5);
  });
});
