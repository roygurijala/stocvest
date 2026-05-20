import { describe, expect, test } from "vitest";
import {
  buildSessionContextLines,
  humanizeScenarioGateReason,
  layerDirectionContextLabel,
  resolveLayerPreviewMarks
} from "@/lib/scenario/scenario-preview-panels";
import type { SignalsLayerRowInput } from "@/lib/signals-page-present";

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

  test("weighted alignment caps checkmarks at ratio X/6", () => {
    const rows: SignalsLayerRowInput[] = [
      { key: "technical", name: "Technical", status: "Neutral", explanation: "", score: 55 },
      { key: "news", name: "News", status: "Neutral", explanation: "", score: 50 },
      { key: "macro", name: "Macro", status: "Neutral", explanation: "", score: 50 },
      { key: "sector", name: "Sector", status: "Neutral", explanation: "", score: 48 },
      { key: "geopolitical", name: "Geopolitical", status: "Neutral", explanation: "", score: 50 },
      { key: "internals", name: "Internals", status: "Neutral", explanation: "", score: 50 }
    ];
    const marks = resolveLayerPreviewMarks(rows, "Neutral", {
      alignmentRatio: 0.5,
      conflictedLayerKeys: ["technical", "sector"]
    });
    const aligned = Object.values(marks).filter((m) => m === "aligned").length;
    expect(aligned).toBe(3);
    expect(marks.technical).toBe("conflicted");
    expect(marks.sector).toBe("conflicted");
    expect(marks.internals).toBe("partial");
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
