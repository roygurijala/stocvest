import { describe, expect, test, beforeEach, vi } from "vitest";
import {
  __resetSessionSelectionForTests,
  getLastSelectedId,
  isFirstVisitOfTradingDay,
  recordTradingRoomVisit,
  setLastSelectedId
} from "@/lib/dashboard/trading-room/session-selection";

describe("trading room session selection", () => {
  beforeEach(() => {
    __resetSessionSelectionForTests();
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T14:00:00.000Z")); // Mon ~10 AM ET
  });

  test("restores in-memory selection within the same session", () => {
    setLastSelectedId("swing:AAPL");
    expect(getLastSelectedId()).toBe("swing:AAPL");
  });

  test("first visit ever does not count as a fresh trading-day reset", () => {
    expect(isFirstVisitOfTradingDay()).toBe(false);
  });

  test("first visit on a new NY day triggers fresh start", () => {
    localStorage.setItem("stocvest:trading-room:last-visit-et-date", "2026-06-06");
    expect(isFirstVisitOfTradingDay()).toBe(true);
  });

  test("same-day revisit does not trigger fresh start", () => {
    recordTradingRoomVisit();
    expect(isFirstVisitOfTradingDay()).toBe(false);
  });
});

describe("hasDashboardSymbolInLocation", () => {
  test("detects symbol query in the address bar", async () => {
    const { hasDashboardSymbolInLocation } = await import("@/lib/nav/dashboard-trading-room-deeplink");
    const original = window.location.href;
    window.history.replaceState({}, "", "/dashboard?symbol=SOXS&lane=swing");
    try {
      expect(hasDashboardSymbolInLocation()).toBe(true);
    } finally {
      window.history.replaceState({}, "", original);
    }
  });

  test("false on bare dashboard path", async () => {
    const { hasDashboardSymbolInLocation } = await import("@/lib/nav/dashboard-trading-room-deeplink");
    const original = window.location.href;
    window.history.replaceState({}, "", "/dashboard");
    try {
      expect(hasDashboardSymbolInLocation()).toBe(false);
    } finally {
      window.history.replaceState({}, "", original);
    }
  });
});
