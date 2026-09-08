import { describe, expect, it } from "vitest";
import {
  watchlistHeatShowsStateBadge,
  watchlistHeatStateBadgeLabel
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
});
