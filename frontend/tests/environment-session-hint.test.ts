import { describe, expect, test } from "vitest";
import { environmentSessionCardHint, environmentTierSessionLabel } from "@/lib/signal-evidence/environment-session-hint";
import type { MarketEnvironmentPayload } from "@/lib/signal-evidence/market-environment-present";

function env(overrides: Partial<MarketEnvironmentPayload> = {}): MarketEnvironmentPayload {
  return {
    policy_version: "env_policy_v2",
    environment_tier: "elevated",
    vix_level: 22,
    vix_direction: "flat",
    vix_change_pct: null,
    macro_regime: "neutral",
    mode: "swing",
    new_swing_allowed: true,
    new_day_allowed: true,
    min_rr_swing: 3,
    min_rr_day: 1.8,
    min_rr: 3,
    target_policy: "t1_preferred",
    size_guidance: "reduced",
    headline: "Elevated volatility — swing ledger requires ≥3:1 R/R.",
    ledger_environment_pass: true,
    ...overrides
  };
}

describe("environment-session-hint", () => {
  test("environmentTierSessionLabel maps elevated", () => {
    expect(environmentTierSessionLabel("elevated")).toBe("ELEVATED SESSION");
  });

  test("elevated swing actionable shows raised R/R hint", () => {
    expect(environmentSessionCardHint(env(), "swing", "actionable")).toBe(
      "ELEVATED SESSION · Minimum R/R raised to 3.0:1"
    );
  });

  test("stressed swing shows entries paused", () => {
    expect(
      environmentSessionCardHint(
        env({ environment_tier: "stressed", new_swing_allowed: false, min_rr: 3 }),
        "swing",
        "actionable"
      )
    ).toBe("STRESSED SESSION · New swing validation entries paused");
  });

  test("normal tier returns null", () => {
    expect(environmentSessionCardHint(env({ environment_tier: "normal", min_rr: 2 }), "swing", "actionable")).toBeNull();
  });

  test("cooling state returns null", () => {
    expect(environmentSessionCardHint(env(), "swing", "cooling")).toBeNull();
  });
});
