import { describe, expect, test } from "vitest";
import {
  buildMissedTodayCardModel,
  buildMissedTodayCardModels,
  indexDeskMoversBySymbol
} from "@/lib/dashboard/missed-today-present";
import type { DeskMoverRadarRow, DeskRecentlyHotRow } from "@/lib/api/desk-today";

describe("missed-today-present", () => {
  test("extended up move uses extended lesson copy", () => {
    const row: DeskRecentlyHotRow = {
      symbol: "MU",
      dropped_at: "2026-05-26T15:00:00Z",
      gap_percent: 16.2,
      reason: "dropped_from_discovery"
    };
    const movers = new Map<string, DeskMoverRadarRow>([
      [
        "MU",
        {
          symbol: "MU",
          gap_percent: 16.2,
          direction: "up",
          rank_score: 16.2
        }
      ]
    ]);
    const model = buildMissedTodayCardModel(row, { mode: "swing", moversBySymbol: movers });
    expect(model.lessonLine.toLowerCase()).toContain("extended");
    expect(model.moveLine).toMatch(/16\.2%/);
    expect(model.signalsHref).toContain("MU");
  });

  test("down move uses fade lesson", () => {
    const row: DeskRecentlyHotRow = {
      symbol: "AMD",
      dropped_at: "2026-05-26T15:00:00Z",
      gap_percent: -4.5
    };
    const movers = new Map<string, DeskMoverRadarRow>([
      ["AMD", { symbol: "AMD", gap_percent: -4.5, direction: "down", rank_score: 4.5 }]
    ]);
    const model = buildMissedTodayCardModel(row, { mode: "day", moversBySymbol: movers });
    expect(model.lessonLine.toLowerCase()).toContain("faded");
  });

  test("buildMissedTodayCardModels caps and indexes movers from desk", () => {
    const models = buildMissedTodayCardModels(
      [
        { symbol: "MU", dropped_at: "2026-05-26T15:00:00Z" },
        { symbol: "NVDA", dropped_at: "2026-05-26T14:00:00Z" }
      ],
      {
        mode: "swing",
        deskData: {
          movers_radar: [
            { symbol: "MU", gap_percent: 8, direction: "up", rank_score: 8 }
          ]
        },
        max: 1
      }
    );
    expect(models).toHaveLength(1);
    expect(indexDeskMoversBySymbol({ movers_radar: [{ symbol: "MU", gap_percent: 1, direction: "up", rank_score: 1 }] }).has("MU")).toBe(
      true
    );
  });

  test("uses gap catalyst context as detail when available", () => {
    const model = buildMissedTodayCardModel(
      { symbol: "MU", dropped_at: "2026-05-26T15:00:00Z", gap_percent: 10, reason: "dropped_from_discovery" },
      {
        mode: "swing",
        moversBySymbol: new Map(),
        gapFallback: [
          {
            symbol: "MU",
            gap_pct: 10,
            has_catalyst: true,
            catalyst: { headline: "Earnings beat", category: "earnings", sentiment: "positive", score: 0.8 }
          } as never
        ]
      }
    );
    expect(model.detailLine?.toLowerCase()).toContain("catalyst");
    expect(model.detailLine?.toLowerCase()).toContain("desk scan");
  });
});
