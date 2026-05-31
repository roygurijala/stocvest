import { describe, expect, test } from "vitest";
import { parseLedgerGateSummary } from "@/lib/signal-evidence/ledger-gate-present";

describe("ledger-gate-present", () => {
  test("parseLedgerGateSummary builds rows and qualified flag", () => {
    const summary = parseLedgerGateSummary({
      ledger_qualified: false,
      gate_status: {
        decision_state: { pass: true, value: "actionable", need: "actionable" },
        market_environment: { pass: false, reason: "new_swing_allowed_stressed", tier: "stressed" },
        risk_reward: { pass: true, value: 2.5, min: 3.0 }
      }
    });
    expect(summary?.qualified).toBe(false);
    expect(summary?.rows.some((r) => r.key === "market_environment" && !r.pass)).toBe(true);
    expect(summary?.headline).toContain("blocked");
  });

  test("returns null without gate_status object", () => {
    expect(parseLedgerGateSummary({})).toBeNull();
  });
});
