import { describe, expect, test } from "vitest";
import {
  buildRegimeWhyLine,
  buildRegimeWhyTooltip,
  regimeWhyEmphasize,
  tapeDisagreesWithRegime
} from "@/lib/market-context/regime-why-present";

describe("regime-why-present", () => {
  test("tapeDisagreesWithRegime flags bearish with green indices", () => {
    expect(tapeDisagreesWithRegime("Bearish", 0.2, 1.5)).toBe(true);
    expect(tapeDisagreesWithRegime("Bearish", -0.5, 1.5)).toBe(false);
  });

  test("buildRegimeWhyLine explains bearish vs green tape with VIX", () => {
    const line = buildRegimeWhyLine({
      regimeLabel: "Bearish",
      marketRegime: "risk_off",
      macroScore: 41,
      spyPct: 0.2,
      qqqPct: 1.5,
      vixLevel: 21.5,
      vixPct: 39.7
    });
    expect(line).toContain("Risk-off");
    expect(line).toContain("VIX 21.5");
    expect(line).toContain("SPY +0.2%");
  });

  test("regimeWhyEmphasize when tape disagrees", () => {
    expect(
      regimeWhyEmphasize({
        regimeLabel: "Bearish",
        spyPct: 0.2,
        qqqPct: 1.5
      })
    ).toBe(true);
  });

  test("neutral regime returns null why line", () => {
    expect(buildRegimeWhyLine({ regimeLabel: "Neutral", spyPct: 0.1 })).toBeNull();
  });

  test("tooltip includes macro engine preamble", () => {
    expect(buildRegimeWhyTooltip({ regimeLabel: "Bearish", vixLevel: 22 })).toContain("macro engine");
  });
});
