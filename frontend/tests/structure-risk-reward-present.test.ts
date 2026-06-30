import { describe, expect, test } from "vitest";
import {
  formatEntryZoneRrLine,
  formatRiskRewardLine,
  parsePositiveRiskReward,
  resolveCompositeRiskRewardForDecision,
  resolveStructureRiskReward
} from "@/lib/structure-risk-reward-present";

describe("structure-risk-reward-present", () => {
  test("parsePositiveRiskReward rejects zero and negative", () => {
    expect(parsePositiveRiskReward(0)).toBeNull();
    expect(parsePositiveRiskReward(1.4)).toBeCloseTo(1.4);
  });

  test("resolveStructureRiskReward prefers structure over headline", () => {
    expect(
      resolveStructureRiskReward({
        structure_risk_reward: 1.6,
        risk_reward: 0
      })
    ).toBeCloseTo(1.6);
  });

  test("formatRiskRewardLine hides invalid ratios", () => {
    expect(formatRiskRewardLine(0)).toBeNull();
    expect(formatRiskRewardLine(1.4, { minGate: 2 })).toContain("below 2.0:1");
    expect(formatRiskRewardLine(2.2, { minGate: 2 })).toContain("clears 2.0:1");
  });

  test("formatEntryZoneRrLine", () => {
    expect(formatEntryZoneRrLine(1.8)).toBe("At entry zone top 1.8:1");
    expect(formatEntryZoneRrLine(0)).toBeNull();
  });

  test("resolveCompositeRiskRewardForDecision marks missing geometry as warning", () => {
    const out = resolveCompositeRiskRewardForDecision({ risk_reward: 0, rr_warning: true }, 2);
    expect(out.riskReward).toBe(0);
    expect(out.rrWarning).toBe(true);
    expect(out.structureRr).toBeNull();
  });
});
