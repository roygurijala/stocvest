import { describe, expect, test } from "vitest";
import {
  buildScenarioComparisonRows,
  scenarioGeometryLevelsMatch
} from "@/lib/scenario/scenario-comparison-rows";
import {
  buildScenarioGeometrySource,
  buildScenarioVariantCatalog,
  resolveScenarioLevels
} from "@/lib/scenario/scenario-variants";

describe("scenario-comparison-rows", () => {
  const source = buildScenarioGeometrySource({
    bias: "Bullish",
    entryZoneLow: 18,
    entryZoneHigh: 19,
    last: 18.43,
    structuralStop: 11.84,
    target1: 31.62,
    target2: 35,
    vwap: 18.2,
    systemRiskReward: 2
  })!;

  const catalog = buildScenarioVariantCatalog(source)!;
  const systemDefault = resolveScenarioLevels(source, catalog.presets.default)!;

  test("scenarioGeometryLevelsMatch ignores sub-cent drift", () => {
    expect(
      scenarioGeometryLevelsMatch(
        { entry: 18.43, stop: 11.84, target: 31.62 },
        { entry: 18.434, stop: 11.836, target: 31.624 }
      )
    ).toBe(true);
  });

  test("hides Your draft when user levels match System default", () => {
    const rows = buildScenarioComparisonRows(
      catalog,
      systemDefault.entry,
      systemDefault.stop,
      systemDefault.target
    );
    expect(rows.map((r) => r.id)).toEqual(["default", "conservative", "aggressive"]);
    expect(rows.some((r) => r.id === "your_draft")).toBe(false);
  });

  test("shows Your draft when user edits away from System default", () => {
    const rows = buildScenarioComparisonRows(catalog, systemDefault.entry + 1, systemDefault.stop, systemDefault.target);
    const draft = rows.find((r) => r.id === "your_draft");
    expect(draft?.label).toBe("Your draft");
    expect(draft?.entry).toBe(systemDefault.entry + 1);
  });

  test("shows Your draft after applying a non-default preset", () => {
    const conservative = resolveScenarioLevels(source, catalog.presets.conservative)!;
    const rows = buildScenarioComparisonRows(catalog, conservative.entry, conservative.stop, conservative.target);
    expect(rows.some((r) => r.id === "your_draft")).toBe(true);
  });
});
