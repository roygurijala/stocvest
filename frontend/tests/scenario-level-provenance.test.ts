import { describe, expect, test } from "vitest";
import { formatApiStopProvenance, formatScenarioLevelProvenance } from "@/lib/scenario/scenario-level-provenance";

describe("scenario-level-provenance", () => {
  test("formatApiStopProvenance passes through label", () => {
    expect(formatApiStopProvenance("Below session low — structural buffer")).toContain("session low");
  });

  test("formatScenarioLevelProvenance maps structure stop", () => {
    const out = formatScenarioLevelProvenance({
      entry: "zone",
      stop: "structure",
      target: "composite"
    });
    expect(out.stop).toContain("Session structure");
    expect(out.entry).toContain("Session entry zone");
  });
});
