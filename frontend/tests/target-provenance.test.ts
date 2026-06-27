import { describe, expect, test } from "vitest";
import { structureRiskRewardLong } from "@/lib/risk-reward-structure";
import { evaluateScenarioDeskGate, target2ProvenanceLabel } from "@/lib/target-provenance";

describe("target-provenance honesty layer", () => {
  test("UBXG-like geometry: unanchored T2 does not promote headline R/R", () => {
    const entry = 9.44;
    const stop = 2.86;
    const t1 = 11.4;
    const t2 = 22.7;
    const rr = structureRiskRewardLong(entry, t1, stop, t2, "2r_extension");
    expect(rr).toBeNull();
  });

  test("what-if gate blocks unanchored T2 even when math clears 2:1", () => {
    const gate = evaluateScenarioDeskGate({
      direction: "bullish",
      entry: 9.44,
      stop: 2.86,
      target: 22.7,
      target1: 11.4,
      target2: 22.7,
      target2Provenance: "2r_extension",
      deskMinRr: 2
    });
    expect(gate.clearsDeskRr).toBe(false);
    expect(gate.gateBlockReason).toMatch(/unanchored/i);
    expect(gate.t1Rr).not.toBeNull();
    expect(gate.t1Rr!).toBeLessThan(1);
  });

  test("T1-only R/R still returns when T1 is tradable", () => {
    const rr = structureRiskRewardLong(100, 115, 95, 130, "2r_extension");
    expect(rr).not.toBeNull();
    expect(rr!).toBeGreaterThan(1);
  });

  test("structural T2 label flips to support-anchored for a short", () => {
    expect(target2ProvenanceLabel("resistance")).toBe("Resistance-anchored");
    expect(target2ProvenanceLabel("resistance", "bullish")).toBe("Resistance-anchored");
    // INTC-style short: the downside target is anchored to support, not resistance.
    expect(target2ProvenanceLabel("resistance", "bearish")).toBe("Support-anchored");
    // Unanchored labels are direction-agnostic.
    expect(target2ProvenanceLabel("2r_extension", "bearish")).toBe("2R projection — unanchored");
  });

  test("short gate block reason uses support-anchored wording", () => {
    const gate = evaluateScenarioDeskGate({
      direction: "bearish",
      entry: 127.62,
      stop: 142.16,
      target: 104.92,
      target1: 125.5,
      target2: 104.92,
      target2Provenance: "2r_extension",
      deskMinRr: 2
    });
    expect(gate.gateBlockReason).toMatch(/unanchored/i);
  });
});
