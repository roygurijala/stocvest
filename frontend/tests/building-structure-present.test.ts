import { describe, expect, test } from "vitest";
import type { DeskTodayData } from "@/lib/api/desk-today";
import {
  BUILDING_STRUCTURE_MIN_CARDS,
  buildBuildingStructureCardModel,
  buildingStructureBackfillNote,
  buildingStructureQuietCount,
  resolveBuildingStructureRows
} from "@/lib/dashboard/building-structure-present";
import type { ScannerNearQualificationRow } from "@/lib/scanner-scan-summary";

const colors = {
  surface: "#111",
  border: "#222",
  accent: "#36f",
  bullish: "#0a0",
  bearish: "#a00",
  caution: "#fa0",
  textMuted: "#888"
};

describe("resolveBuildingStructureRows", () => {
  test("quiet leaders only when enough qualify", () => {
    const desk: DeskTodayData = {
      quiet_leaders: [
        { symbol: "A", gap_percent: 0.5, direction: "up", rank_score: 1, desk: "swing" },
        { symbol: "B", gap_percent: -0.3, direction: "down", rank_score: 2, desk: "swing" }
      ]
    };
    const rows = resolveBuildingStructureRows({ deskData: desk, nearQualification: [] });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === "quiet_leader")).toBe(true);
  });

  test("backfills with near-qualification when quiet list is sparse", () => {
    const desk: DeskTodayData = {
      quiet_leaders: [{ symbol: "QL", gap_percent: 0.2, direction: "up", rank_score: 1, desk: "swing" }]
    };
    const near: ScannerNearQualificationRow[] = [
      {
        symbol: "NR1",
        desk: "swing",
        score: 0.7,
        direction: "long",
        alignment: { aligned: 4, total: 6, label: "4/6" }
      },
      {
        symbol: "NR2",
        desk: "swing",
        score: 0.6,
        direction: "long",
        alignment: { aligned: 4, total: 6, label: "4/6" }
      },
      {
        symbol: "NR3",
        desk: "swing",
        score: 0.5,
        direction: "long",
        alignment: { aligned: 4, total: 6, label: "4/6" }
      },
      {
        symbol: "NR4",
        desk: "swing",
        score: 0.4,
        direction: "long",
        alignment: { aligned: 4, total: 6, label: "4/6" }
      },
      {
        symbol: "NR5",
        desk: "swing",
        score: 0.3,
        direction: "long",
        alignment: { aligned: 4, total: 6, label: "4/6" }
      }
    ];
    const rows = resolveBuildingStructureRows({ deskData: desk, nearQualification: near });
    expect(rows.length).toBeGreaterThanOrEqual(BUILDING_STRUCTURE_MIN_CARDS);
    expect(buildingStructureQuietCount(rows)).toBe(1);
    expect(rows.some((r) => r.source === "near_qualification")).toBe(true);
    expect(buildingStructureBackfillNote(rows)).toMatch(/near-ready/i);
  });

  test("excludes session-activity symbols from backfill", () => {
    const desk: DeskTodayData = { quiet_leaders: [] };
    const near: ScannerNearQualificationRow[] = [
      {
        symbol: "HOT",
        desk: "swing",
        score: 0.9,
        direction: "long",
        alignment: { aligned: 4, total: 6, label: "4/6" }
      }
    ];
    const rows = resolveBuildingStructureRows({
      deskData: desk,
      nearQualification: near,
      sessionActivitySymbols: ["HOT"]
    });
    expect(rows.find((r) => r.symbol === "HOT")).toBeUndefined();
  });

  test("low-velocity movers fill remaining slots", () => {
    const desk: DeskTodayData = {
      quiet_leaders: [],
      movers_radar: [
        { symbol: "LV1", gap_percent: 0.8, direction: "up", rank_score: 10 },
        { symbol: "LV2", gap_percent: -1.1, direction: "down", rank_score: 9 },
        { symbol: "LV3", gap_percent: 1.5, direction: "up", rank_score: 8 },
        { symbol: "FAST", gap_percent: 12, direction: "up", rank_score: 99 }
      ]
    };
    const rows = resolveBuildingStructureRows({ deskData: desk, nearQualification: [] });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.some((r) => r.symbol === "FAST")).toBe(false);
    expect(rows.some((r) => r.source === "low_velocity")).toBe(true);
  });
});

describe("buildBuildingStructureCardModel", () => {
  test("near-structure card uses review badge", () => {
    const model = buildBuildingStructureCardModel(
      {
        source: "near_qualification",
        symbol: "AMD",
        nearQual: {
          symbol: "AMD",
          desk: "swing",
          score: 0.5,
          direction: "long",
          alignment: { aligned: 4, total: 6, label: "4/6" }
        }
      },
      { rank: 2, mode: "swing", deskData: null, colors }
    );
    expect(model.setupBadgeLabel).toBe("Near structure");
    expect(model.statusHeadline).toMatch(/structure/i);
  });
});
