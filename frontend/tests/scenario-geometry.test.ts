import { describe, expect, test } from "vitest";

import { scenarioGeometryError } from "@/lib/scenario/scenario-geometry";
import { resolveScenarioVerdict } from "@/lib/scenario/scenario-verdict";

describe("scenario-geometry", () => {
  test("long_stop_above_entry_returns_error", () => {
    const msg = scenarioGeometryError("bullish", 5.05, 5.1696, 5.55);
    expect(msg).toContain("above stop");
    expect(msg).toContain("5.17");
  });

  test("valid_long_geometry_no_error", () => {
    expect(scenarioGeometryError("bullish", 5.2, 5.0, 5.8)).toBeNull();
  });
});

describe("resolveScenarioVerdict geometry", () => {
  test("invalid_long_geometry_blocks_verdict", () => {
    const v = resolveScenarioVerdict({
      systemDecision: {
        state: "actionable",
        line: "ok",
        reinforcements: [],
        rationale: null
      },
      mode: "swing",
      direction: "bullish",
      entry: 5.05,
      stop: 5.1696,
      target: 5.55
    });
    expect(v.tone).toBe("red");
    expect(v.scenarioRr).toBeNull();
    expect(v.detail).toContain("above stop");
  });
});
