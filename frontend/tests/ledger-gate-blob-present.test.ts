import { describe, expect, test } from "vitest";
import {
  formatEnvironmentAuditLine,
  parseLedgerGateBlob,
  parseMarketEnvironmentAudit
} from "@/lib/signal-evidence/ledger-gate-blob-present";

describe("ledger-gate-blob-present", () => {
  test("parseMarketEnvironmentAudit reads v2 audit fields", () => {
    const audit = parseMarketEnvironmentAudit({
      policy_version: "env_policy_v2",
      environment_tier: "stressed",
      environment_tier_raw: "elevated",
      hysteresis_applied: true,
      vix_level: 29.2,
      target_policy: "t1_only"
    });
    expect(audit?.environment_tier).toBe("stressed");
    expect(formatEnvironmentAuditLine(audit)).toContain("Stressed");
    expect(formatEnvironmentAuditLine(audit)).toContain("held");
  });

  test("parseLedgerGateBlob unwraps nested gates + audit", () => {
    const parsed = parseLedgerGateBlob({
      qualified: false,
      gates: {
        market_environment: { pass: false, tier: "crisis", reason: "new_swing_allowed_crisis" },
        risk_reward: { pass: true, value: 3.2, min: 3 }
      },
      market_environment_audit: {
        policy_version: "env_policy_v2",
        environment_tier: "crisis",
        vix_level: 33
      }
    });
    expect(parsed?.qualified).toBe(false);
    expect(parsed?.gates?.rows.some((r) => r.key === "market_environment")).toBe(true);
    expect(parsed?.marketEnvironmentAudit?.environment_tier).toBe("crisis");
  });
});
