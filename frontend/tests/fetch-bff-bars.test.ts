import { describe, expect, it } from "vitest";
import { lookupSnapshot } from "@/lib/api/fetch-bff-snapshots";
import { pctFromDailyCloses, sessionsBackForHeatWindow } from "@/lib/api/fetch-bff-bars";

describe("fetch-bff-snapshots lookup", () => {
  it("finds snapshots by canonical alias", () => {
    const map = new Map([["BRK.B", { symbol: "BRK.B", change_percent: 1.2 }]]);
    expect(lookupSnapshot(map, "BRK-B")?.change_percent).toBe(1.2);
  });
});

describe("fetch-bff-bars heat windows", () => {
  it("derives window returns from daily closes", () => {
    const closes = [100, 101, 102, 103, 104, 105];
    expect(pctFromDailyCloses(closes, "1w")).toBeCloseTo(4.95, 1);
    expect(sessionsBackForHeatWindow("3m")).toBe(63);
  });
});
