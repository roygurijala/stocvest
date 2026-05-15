import { describe, expect, it } from "vitest";
import type { IntradaySetupPayload } from "@/lib/api/scanner";
import { buildWatchlistDashboardStatus } from "@/lib/api/scanner-load";

describe("buildWatchlistDashboardStatus", () => {
  it("uses legacy universe vs setups when maturation is absent", () => {
    const setups: IntradaySetupPayload[] = [{ symbol: "SPY", score: 0.9 } as IntradaySetupPayload];
    const out = buildWatchlistDashboardStatus(["SPY", "ZZZ"], ["SPY", "QQQ"], setups);
    expect(out).toEqual({ monitored: 2, actionable: 1, developing: 0, inactive: 1 });
  });

  it("counts maturation actionable without setup or universe row", () => {
    const out = buildWatchlistDashboardStatus(["XYZ"], ["SPY"], [], { XYZ: "actionable" });
    expect(out).toEqual({ monitored: 1, actionable: 1, developing: 0, inactive: 0 });
  });

  it("setup row wins over maturation state", () => {
    const setups: IntradaySetupPayload[] = [{ symbol: "XYZ", score: 0.9 } as IntradaySetupPayload];
    const out = buildWatchlistDashboardStatus(["XYZ"], [], setups, { XYZ: "not_aligned" });
    expect(out).toEqual({ monitored: 1, actionable: 1, developing: 0, inactive: 0 });
  });
});
