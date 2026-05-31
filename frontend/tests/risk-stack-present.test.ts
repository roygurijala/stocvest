import { describe, expect, test } from "vitest";
import { buildRiskStackSummary, parseApiDecisionState } from "@/lib/signal-evidence/risk-stack-present";
import type { MarketEnvironmentPayload } from "@/lib/signal-evidence/market-environment-present";

function env(overrides: Partial<MarketEnvironmentPayload> = {}): MarketEnvironmentPayload {
  return {
    policy_version: "env_policy_v2",
    environment_tier: "stressed",
    vix_level: 29,
    vix_direction: "rising",
    vix_change_pct: 2,
    macro_regime: "Neutral",
    mode: "swing",
    new_swing_allowed: false,
    new_day_allowed: true,
    min_rr_swing: 3,
    min_rr_day: 1.8,
    min_rr: 3,
    target_policy: "t1_only",
    size_guidance: "reduced",
    headline: "Stressed environment — pause new swing entries.",
    ledger_environment_pass: false,
    ...overrides
  };
}

describe("risk-stack-present", () => {
  test("parseApiDecisionState accepts composite values", () => {
    expect(parseApiDecisionState("actionable")).toBe("actionable");
    expect(parseApiDecisionState("blocked")).toBe("blocked");
    expect(parseApiDecisionState("nope")).toBeNull();
  });

  test("buildRiskStackSummary flags environment vs signal decoupling", () => {
    const summary = buildRiskStackSummary({
      environment: env(),
      signalState: "actionable",
      insight: {
        risk_reward: 2.5,
        reference_stop_level: 98,
        reference_target_1: 105,
        reference_target_2: null,
        reference_stop_provenance: "structure+atr",
        alignment_ratio: 0.6
      } as import("@/lib/signal-evidence").SignalEvidenceInsight,
      ledgerGates: {
        qualified: false,
        headline: "blocked",
        rows: [
          { key: "market_environment", label: "Market environment", pass: false, detail: "stressed" }
        ]
      }
    });
    expect(summary.environmentBlocksLedger).toBe(true);
    expect(summary.decouplingMessage).toContain("paused");
    expect(summary.rows).toHaveLength(4);
    expect(summary.rows.find((r) => r.layer === "environment")?.status).toBe("fail");
    expect(summary.rows.find((r) => r.layer === "signal")?.status).toBe("pass");
  });

  test("plan row fails when R/R below desk minimum", () => {
    const summary = buildRiskStackSummary({
      environment: env({ environment_tier: "elevated", new_swing_allowed: true, min_rr: 3 }),
      signalState: "monitor",
      insight: {
        risk_reward: 2.2,
        reference_stop_level: 98,
        reference_target_1: 105
      } as import("@/lib/signal-evidence").SignalEvidenceInsight,
      ledgerGates: null
    });
    expect(summary.rows.find((r) => r.layer === "plan")?.status).toBe("fail");
  });
});
