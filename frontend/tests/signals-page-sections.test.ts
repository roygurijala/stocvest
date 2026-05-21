import { describe, expect, test } from "vitest";

import { buildSignalsSectionLinks } from "@/lib/signals-page-sections";

describe("buildSignalsSectionLinks", () => {
  test("includes setup, layers, radar, evolution when signal and radar present", () => {
    const links = buildSignalsSectionLinks({
      hasValidSignal: true,
      hasRadar: true,
      hasAfterHours: false
    });
    expect(links.map((l) => l.id)).toEqual(["setup", "layers", "radar", "evolution"]);
  });

  test("returns empty when no valid signal", () => {
    expect(
      buildSignalsSectionLinks({ hasValidSignal: false, hasRadar: false, hasAfterHours: false })
    ).toEqual([]);
  });
});
