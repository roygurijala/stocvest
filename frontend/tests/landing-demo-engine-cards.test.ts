import { describe, expect, test } from "vitest";
import {
  LANDING_ENGINE_DAY_DEMO,
  LANDING_ENGINE_SWING_DEMO,
  landingEngineDemoForMode
} from "@/lib/landing/demo-engine-cards";

describe("landing demo engine cards", () => {
  test("swing demo matches NVDA actionable verdict", () => {
    expect(LANDING_ENGINE_SWING_DEMO.symbol).toBe("NVDA");
    expect(LANDING_ENGINE_SWING_DEMO.actionable).toBe(true);
    expect(LANDING_ENGINE_SWING_DEMO.aligned).toBe(6);
    expect(LANDING_ENGINE_SWING_DEMO.levelsLine).toMatch(/R\/R 2\.8:1/);
  });

  test("day demo shows MSFT monitor-only restraint", () => {
    expect(LANDING_ENGINE_DAY_DEMO.symbol).toBe("MSFT");
    expect(LANDING_ENGINE_DAY_DEMO.actionable).toBe(false);
    expect(LANDING_ENGINE_DAY_DEMO.execution).toMatch(/monitor only/i);
    expect(LANDING_ENGINE_DAY_DEMO.metaLine).toMatch(/confluence alert/i);
  });

  test("landingEngineDemoForMode selects desk card", () => {
    expect(landingEngineDemoForMode("swing").desk).toBe("swing");
    expect(landingEngineDemoForMode("day").desk).toBe("day");
  });
});
