import { describe, expect, test } from "vitest";
import { deriveSessionReferenceLevels } from "@/lib/snapshot-reference-levels";
import type { SnapshotPayload } from "@/lib/api/market";

describe("deriveSessionReferenceLevels", () => {
  test("uses day high/low when last trade is missing", () => {
    const snap: SnapshotPayload = {
      symbol: "AAPL",
      day_high: 190.5,
      day_low: 188.2
    };
    const r = deriveSessionReferenceLevels(snap, null);
    expect(r.support).toBeCloseTo(188.2, 5);
    expect(r.resistance).toBeCloseTo(190.5, 5);
    expect(r.vwap).toBeCloseTo((188.2 + 190.5) / 2, 5);
  });

  test("fills from composite when snapshot has no prices", () => {
    const r = deriveSessionReferenceLevels(null, {
      historical_entry_zone: { low: 100, high: 102 },
      vwap: 101.25,
      reference_stop_level: 99.5,
      reference_target_1: 103
    });
    expect(r.support).toBe(100);
    expect(r.resistance).toBe(102);
    expect(r.vwap).toBe(101.25);
  });

  test("composite VWAP when snapshot has symbol only", () => {
    const r = deriveSessionReferenceLevels({ symbol: "Z" }, { vwap: 55.1 });
    expect(r.vwap).toBe(55.1);
    expect(r.support).toBeNull();
  });
});
