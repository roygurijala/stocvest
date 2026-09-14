import { describe, expect, test } from "vitest";

import {
  canTradingRoomHistoryBack,
  resolveTradingRoomReturnNav
} from "@/lib/nav/trading-room-return-nav";

describe("resolveTradingRoomReturnNav", () => {
  test("maps invest and gem refs to Invest", () => {
    for (const ref of ["invest", "invest-search", "invest-compare", "gem-rail"]) {
      expect(resolveTradingRoomReturnNav(ref)).toEqual({
        label: "Invest",
        href: "/dashboard/invest"
      });
    }
  });

  test("maps portfolio refs to My Portfolio", () => {
    for (const ref of ["portfolio", "my-portfolio", "holdings"]) {
      expect(resolveTradingRoomReturnNav(ref)).toEqual({
        label: "My Portfolio",
        href: "/dashboard/my-portfolio"
      });
    }
  });

  test("maps other in-app refs", () => {
    expect(resolveTradingRoomReturnNav("scanner")).toEqual({
      label: "Scanner",
      href: "/dashboard/scanner"
    });
    expect(resolveTradingRoomReturnNav("watchlist")).toEqual({
      label: "Watchlists",
      href: "/dashboard/watchlists"
    });
  });

  test("returns null for session-brief and unknown refs", () => {
    expect(resolveTradingRoomReturnNav("")).toBeNull();
    expect(resolveTradingRoomReturnNav(null)).toBeNull();
    expect(resolveTradingRoomReturnNav("dashboard")).toBeNull();
    expect(resolveTradingRoomReturnNav("assistant")).toBeNull();
    expect(resolveTradingRoomReturnNav("marketing")).toBeNull();
  });
});

describe("canTradingRoomHistoryBack", () => {
  test("returns false without a same-origin dashboard origin page", () => {
    expect(canTradingRoomHistoryBack()).toBe(false);
  });
});
