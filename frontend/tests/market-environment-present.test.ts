import { describe, expect, test } from "vitest";
import { environmentTierLabel, parseMarketEnvironment } from "@/lib/signal-evidence/market-environment-present";

describe("market-environment-present", () => {
  test("parseMarketEnvironment reads composite block", () => {
    const env = parseMarketEnvironment({
      market_environment: {
        policy_version: "env_policy_v2",
        environment_tier: "elevated",
        environment_tier_raw: "elevated",
        hysteresis_applied: false,
        vix_level: 22.5,
        vix_direction: "rising",
        vix_change_5d_pct: 4.2,
        headline: "Elevated volatility — swing ledger requires ≥3:1 R/R.",
        mode: "swing",
        new_swing_allowed: true,
        new_day_allowed: true,
        min_rr_swing: 3,
        min_rr_day: 1.8,
        min_rr: 3,
        target_policy: "t1_preferred",
        size_guidance: "reduced",
        ledger_environment_pass: true
      }
    });
    expect(env?.environment_tier).toBe("elevated");
    expect(env?.vix_change_5d_pct).toBe(4.2);
    expect(env?.min_rr).toBe(3);
    expect(environmentTierLabel("crisis")).toBe("Crisis");
  });
});
