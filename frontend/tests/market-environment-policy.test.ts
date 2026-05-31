import { describe, expect, test } from "vitest";
import {
  buildClientMarketEnvironmentPolicy,
  ENVIRONMENT_POLICY_VERSION,
  resolveEnvironmentTier,
  resolveEnvironmentTierRaw
} from "@/lib/market-environment/policy";

describe("market-environment policy", () => {
  test("resolveEnvironmentTier matches backend bands", () => {
    expect(resolveEnvironmentTier(17)).toBe("normal");
    expect(resolveEnvironmentTier(24)).toBe("elevated");
    expect(resolveEnvironmentTier(30)).toBe("stressed");
    expect(resolveEnvironmentTier(33)).toBe("crisis");
    expect(resolveEnvironmentTier(23, 11)).toBe("stressed");
    expect(resolveEnvironmentTier(21, null, 13)).toBe("stressed");
  });

  test("resolveEnvironmentTierRaw without hysteresis", () => {
    expect(resolveEnvironmentTierRaw(18)).toBe("normal");
    expect(resolveEnvironmentTierRaw(29)).toBe("stressed");
  });

  test("buildClientMarketEnvironmentPolicy swing elevated v2", () => {
    const pol = buildClientMarketEnvironmentPolicy({
      mode: "swing",
      vixLevel: 22,
      macroRegime: "Bullish"
    });
    expect(pol.policy_version).toBe(ENVIRONMENT_POLICY_VERSION);
    expect(pol.min_rr).toBe(3);
    expect(pol.environment_tier).toBe("elevated");
    expect(pol.new_swing_allowed).toBe(true);
    expect(pol.environment_tier_raw).toBe("elevated");
  });
});
