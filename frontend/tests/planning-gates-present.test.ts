import { describe, expect, test } from "vitest";
import { buildPlanningGatesClient } from "@/lib/signal-evidence/planning-gates-present";

describe("planning-gates-present", () => {
  test("buildPlanningGatesClient marks volume pass at 1.5x", () => {
    const gates = buildPlanningGatesClient({
      mode: "swing",
      marketRegime: "Neutral",
      riskReward: 2.2,
      executionQuality: {
        band: "moderate",
        stop_atr_ratio: 1.0,
        level_path: {
          has_reference_stop: true,
          has_reference_target: true,
          structure_complete: true
        },
        volume_ratio: 1.55,
        volume_band: "moderate",
        risk_reward: 2.2,
        session_window: {},
        setup_tags: [],
        disclaimer: ""
      },
      referenceStopProvenance: "widened to 1.0×ATR14 floor",
      atr: 3,
      setupJudgment: null
    });
    const vol = gates.checks.find((c) => c.id === "volume");
    expect(vol?.pass).toBe(true);
    expect(gates.preset_fit.dip).toContain("range");
  });
});
