import { describe, expect, test } from "vitest";
import { buildGeometryHonestyPresent } from "@/lib/dashboard/geometry-honesty-present";

describe("geometry-honesty-present", () => {
  test("swing shows stop distance and T1 R/R like email", () => {
    const out = buildGeometryHonestyPresent({
      tradingMode: "swing",
      price: 7.78,
      body: {
        reference_stop_distance_atr: 2.35,
        reference_stop_level: 7.31,
        reference_target_1: 8.5,
        risk_reward: 0.4,
        t1_risk_reward: 0.4,
        min_rr_desk: 2.0
      }
    });
    expect(out.showPanel).toBe(true);
    const stop = out.rows.find((r) => r.label === "Stop distance");
    expect(stop?.value).toBe("2.35×ATR (6.0%)");
    const t1 = out.rows.find((r) => r.label === "T1 risk / reward");
    expect(t1?.value).toBe("0.40 (min 2.00)");
  });

  test("stop_too_tight_for_swing downgrades with headline", () => {
    const out = buildGeometryHonestyPresent({
      tradingMode: "swing",
      price: 22.0,
      body: {
        geometry_block_reason: "stop_too_tight_for_swing",
        reference_stop_distance_atr: 0.95,
        reference_stop_level: 21.5,
        reference_target_1: 24.0,
        t1_risk_reward: 4.0,
        min_rr_desk: 2.0
      }
    });
    expect(out.headline).toBe("Stop too tight for swing desk");
    const stop = out.rows.find((r) => r.label === "Stop distance");
    expect(stop?.tone).toBe("caution");
    expect(stop?.note).toContain("1.5×ATR");
    const t1 = out.rows.find((r) => r.label === "T1 risk / reward");
    expect(t1?.note).toContain("desk blocks swing execution");
  });

  test("day shows plan and separate T1 when they differ", () => {
    const out = buildGeometryHonestyPresent({
      tradingMode: "day",
      price: 100,
      body: {
        reference_stop_level: 95,
        reference_target_1: 101,
        reference_target_2: 115,
        reference_target_2_provenance: "resistance",
        structure_risk_reward: 3.0,
        t1_risk_reward: 0.2,
        min_rr_desk: 2.0
      }
    });
    const plan = out.rows.find((r) => r.label === "Plan R/R (T2)");
    expect(plan?.value).toBe("3.00 (min 2.00)");
    expect(plan?.note).toContain("T1 was sub-1:1");
    const t1 = out.rows.find((r) => r.label === "T1 risk / reward");
    expect(t1?.value).toBe("0.20 (min 2.00)");
  });

  test("returns empty panel when no geometry fields", () => {
    const out = buildGeometryHonestyPresent({
      tradingMode: "swing",
      body: {}
    });
    expect(out.showPanel).toBe(false);
    expect(out.rows).toHaveLength(0);
  });
});
