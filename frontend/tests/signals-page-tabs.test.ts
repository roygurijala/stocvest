import { describe, expect, test } from "vitest";
import {
  deskTabHighlightsKpi,
  kpiTargetScrollId,
  kpiTargetToDeskTab,
  parseSignalsDeskTab,
  SIGNALS_DESK_TABS
} from "@/lib/signals-page-tabs";
import { SIGNALS_SECTION_TARGET } from "@/lib/signals-page-sections";
import { buildSignalsDeskKpiItems } from "@/lib/signals-desk-kpi-present";
import type { SignalsLayerRowInput } from "@/lib/signals-page-present";

const rows: SignalsLayerRowInput[] = [
  { key: "technical", name: "Technical", status: "Bearish", explanation: "", score: 40 },
  { key: "news", name: "News", status: "Neutral", explanation: "", score: 50 },
  { key: "macro", name: "Macro", status: "Neutral", explanation: "", score: 50 },
  { key: "sector", name: "Sector", status: "Bearish", explanation: "", score: 35 },
  { key: "geopolitical", name: "Geopolitical", status: "Neutral", explanation: "", score: 50 },
  { key: "internals", name: "Internals", status: "Bullish", explanation: "", score: 58 }
];

describe("signals-page-tabs", () => {
  test("parses known tab query values", () => {
    expect(parseSignalsDeskTab("layers")).toBe("layers");
    expect(parseSignalsDeskTab("evolution")).toBe("evolution");
    expect(parseSignalsDeskTab("nope")).toBe("setup");
    expect(SIGNALS_DESK_TABS).toEqual(["setup", "layers", "evolution"]);
  });

  test("maps KPI targets to desk tabs", () => {
    expect(kpiTargetToDeskTab("bias")).toBe("setup");
    expect(kpiTargetToDeskTab("execution")).toBe("setup");
    expect(kpiTargetToDeskTab("alignment")).toBe("layers");
    expect(deskTabHighlightsKpi("setup", "bias")).toBe(true);
    expect(deskTabHighlightsKpi("layers", "alignment")).toBe(true);
    expect(deskTabHighlightsKpi("setup", "alignment")).toBe(false);
  });

  test("maps KPI targets to scroll section ids", () => {
    expect(kpiTargetScrollId("bias")).toBe(SIGNALS_SECTION_TARGET.biasRationale);
    expect(kpiTargetScrollId("execution")).toBe(SIGNALS_SECTION_TARGET.whyNotActionable);
    expect(kpiTargetScrollId("alignment")).toBe(SIGNALS_SECTION_TARGET.layers);
  });
});

describe("buildSignalsDeskKpiItems", () => {
  test("builds bias, alignment, execution headlines", () => {
    const items = buildSignalsDeskKpiItems({
      bias: "Bearish",
      rows,
      tradingMode: "swing",
      decision: {
        state: "monitor",
        line: "Held",
        reinforcements: [],
        rationale: {
          category: "risk_reward",
          label: "Why hold:",
          text: "Risk/reward too low (0.5:1) — below threshold."
        }
      }
    });
    expect(items).toHaveLength(3);
    expect(items[0].headline).toBe("Bearish");
    expect(items[1].headline).toContain("Developing");
    expect(items[2].headline).toBe("Not actionable yet");
    expect(items[2].subline).toMatch(/Risk\/reward/i);
  });
});
