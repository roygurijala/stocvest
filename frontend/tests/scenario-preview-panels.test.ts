import { describe, expect, test } from "vitest";
import {
  buildSessionContextLines,
  humanizeScenarioGateReason,
  layerDirectionContextLabel
} from "@/lib/scenario/scenario-preview-panels";

describe("scenario-preview-panels", () => {
  test("humanizeScenarioGateReason market_closed", () => {
    expect(humanizeScenarioGateReason("market_closed")).toBe(
      "Market is closed — execution planning unavailable"
    );
  });

  test("layerDirectionContextLabel maps blocking to weak", () => {
    expect(layerDirectionContextLabel("blocking")).toBe("weak");
    expect(layerDirectionContextLabel("supportive")).toBe("supportive");
  });

  test("buildSessionContextLines uses humanized gate copy", () => {
    const lines = buildSessionContextLines({
      gapIntel: {
        gap: { direction: "NONE", gap_size_pct: 0, status: "flat" },
        liquidity: { is_high_liquidity: true },
        phase: { state: "closed", label: "Closed" },
        flags: { stale: false, market_closed: true },
        scenario_builder: { state: "DISABLED", reasons: ["market_closed"] }
      } as never,
      executionTier: "session_limited",
      mode: "swing"
    });
    expect(lines.some((l) => l.includes("Market is closed"))).toBe(true);
    expect(lines.some((l) => l.includes("Scenario gate:"))).toBe(false);
  });
});
