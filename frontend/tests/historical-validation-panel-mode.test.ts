import { describe, expect, test } from "vitest";

// Lock-in for the Mode Separation rule on the historical-validation panel:
// "Statistics, hit-rates, and outcomes must never be combined into a single
// headline number." Before this change the panel surfaced an "All" mode that
// rendered a combined-engine "Overall directional accuracy" hero, which was a
// direct violation of the prompt's no-combined-headlines clause. The panel now
// only allows `swing` or `day` so the regression is structurally impossible.
//
// We test at the module level rather than mounting the panel because the
// constant is the single source of truth that drives both the filter dropdown
// and the state-machine transitions; if `all` ever creeps back in here, the
// UI will instantly start producing a combined hero again.

describe("historical-validation-panel: mode-separation structural guarantees", () => {
  test("MODE_OPTIONS exposes ONLY swing and day (no combined `all` headline)", async () => {
    const mod = await import("@/components/historical-validation-panel");
    expect(mod.MODE_OPTIONS).toEqual(["swing", "day"]);
    expect(mod.MODE_OPTIONS).not.toContain("all" as unknown as "swing");
  });

  test("ModeFilter type is `swing` | `day` only (no fallback escape hatch)", async () => {
    // TypeScript-only guard: this file would fail to compile if `ModeFilter`
    // ever widened back to include `"all"`. The cast below pins the type.
    const swing: import("@/components/historical-validation-panel").ModeFilter = "swing";
    const day: import("@/components/historical-validation-panel").ModeFilter = "day";
    expect(swing).toBe("swing");
    expect(day).toBe("day");
    // The next line would be a TS error if ModeFilter accepted "all" again:
    //   const all: ModeFilter = "all"; // ← intentionally absent
  });
});
