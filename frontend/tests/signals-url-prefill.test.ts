import { describe, expect, test } from "vitest";
import {
  resolveSignalsUrlSymbol,
  signalsRefAllowsSymbolPrefill
} from "@/lib/signals-url-prefill";

describe("signals-url-prefill", () => {
  test("dashboard refs allow symbol prefill", () => {
    for (const ref of ["dashboard", "dashboard-ribbon", "dashboard-day-desk"]) {
      expect(signalsRefAllowsSymbolPrefill(ref)).toBe(true);
    }
  });

  test("scanner and watchlist refs allow symbol prefill", () => {
    expect(signalsRefAllowsSymbolPrefill("scanner")).toBe(true);
    expect(signalsRefAllowsSymbolPrefill("watchlist")).toBe(true);
  });

  test("unknown refs do not allow symbol prefill", () => {
    expect(signalsRefAllowsSymbolPrefill("")).toBe(false);
    expect(signalsRefAllowsSymbolPrefill("random")).toBe(false);
  });

  test("resolveSignalsUrlSymbol returns ticker for dashboard watchlist radar links", () => {
    expect(resolveSignalsUrlSymbol("ccm", "dashboard")).toBe("CCM");
    expect(resolveSignalsUrlSymbol("AAPL", "dashboard-ribbon")).toBe("AAPL");
  });

  test("resolveSignalsUrlSymbol ignores symbol when ref is not allowlisted", () => {
    expect(resolveSignalsUrlSymbol("AAPL", "marketing")).toBeNull();
  });
});
