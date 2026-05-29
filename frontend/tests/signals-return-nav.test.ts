import { describe, expect, test } from "vitest";
import { canSignalsHistoryBack, resolveSignalsReturnNav } from "@/lib/nav/signals-return-nav";

describe("resolveSignalsReturnNav", () => {
  test("maps dashboard refs to dashboard", () => {
    for (const ref of ["dashboard", "dashboard-ribbon", "dashboard-day-desk"]) {
      expect(resolveSignalsReturnNav(ref)).toEqual({ label: "Dashboard", href: "/dashboard" });
    }
  });

  test("maps contextual refs", () => {
    expect(resolveSignalsReturnNav("watchlist")).toEqual({
      label: "Watchlists",
      href: "/dashboard/watchlists"
    });
    expect(resolveSignalsReturnNav("scanner")).toEqual({
      label: "Scanner",
      href: "/dashboard/scanner"
    });
    expect(resolveSignalsReturnNav("journal")).toEqual({
      label: "Journal",
      href: "/dashboard/journal"
    });
    expect(resolveSignalsReturnNav("setup-outcomes")).toEqual({
      label: "Setup outcomes",
      href: "/dashboard/setup-outcomes"
    });
  });

  test("returns null for unknown refs", () => {
    expect(resolveSignalsReturnNav("")).toBeNull();
    expect(resolveSignalsReturnNav("marketing")).toBeNull();
  });
});

describe("canSignalsHistoryBack", () => {
  test("returns false without window", () => {
    expect(canSignalsHistoryBack()).toBe(false);
  });
});
