import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

import { TradingRoomPeriodicRefresh } from "@/components/dashboard/trading-room/trading-room-periodic-refresh";
import {
  TRADING_ROOM_MATURATION_REFRESH_INTERVAL_MS,
  refreshTradingRoomSidebarMaturation
} from "@/lib/dashboard/trading-room/trading-room-sidebar-refresh";

vi.mock("swr", () => ({
  useSWRConfig: () => ({ mutate: vi.fn() })
}));

vi.mock("@/lib/dashboard/trading-room/trading-room-sidebar-refresh", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dashboard/trading-room/trading-room-sidebar-refresh")>();
  return {
    ...actual,
    fetchDefaultWatchlistSymbols: vi.fn(async () => ["MSFT"]),
    refreshTradingRoomSidebarMaturation: vi.fn(async () => ({ refreshed: ["AAPL"] }))
  };
});

vi.mock("@/lib/dashboard/desk-refresh-tiers", () => ({
  shouldPollDeskTier: () => true
}));

describe("TradingRoomPeriodicRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ symbols: ["MSFT"] }) }))
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test("re-composites stale symbols on interval during RTH", async () => {
    render(
      React.createElement(TradingRoomPeriodicRefresh, {
        dayTradingSurfaces: false,
        feedSymbols: ["AAPL"]
      })
    );

    await vi.advanceTimersByTimeAsync(TRADING_ROOM_MATURATION_REFRESH_INTERVAL_MS);

    expect(refreshTradingRoomSidebarMaturation).toHaveBeenCalledWith(
      ["AAPL", "MSFT"],
      false,
      expect.objectContaining({ maxSymbols: 2 })
    );
  });
});
