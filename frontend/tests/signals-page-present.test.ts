import { describe, expect, test } from "vitest";
import {
  actionableHeadline,
  buildLayerInsightLine,
  buildSignalsPageDecision,
  buildWhyNotBullets,
  countLayerAlignment,
  formatDeltaVsBaselineShort,
  layerDeltaVsBaseline,
  layerPolarity,
  normalizeSetupBias,
  pickCollapsedLayerPreview,
  pickPreviewLayers,
  SIGNAL_LAYER_LEVEL_BASELINE,
  type SignalsLayerRowInput
} from "@/lib/signals-page-present";

const bearishRows: SignalsLayerRowInput[] = [
  { key: "technical", name: "Technical", status: "Bearish", explanation: "", score: 40 },
  { key: "news", name: "News", status: "Neutral", explanation: "", score: 50 },
  { key: "macro", name: "Macro", status: "Neutral", explanation: "", score: 50 },
  { key: "sector", name: "Sector", status: "Bearish", explanation: "", score: 35 },
  { key: "geopolitical", name: "Geopolitical", status: "Neutral", explanation: "", score: 50 },
  { key: "internals", name: "Internals", status: "Bullish", explanation: "", score: 58 }
];

describe("signals-page-present", () => {
  test("normalizeSetupBias", () => {
    expect(normalizeSetupBias("bearish")).toBe("Bearish");
  });

  test("countLayerAlignment for bearish bias", () => {
    const a = countLayerAlignment(bearishRows, "Bearish");
    expect(a.aligned).toBe(2);
    expect(a.total).toBe(6);
  });

  test("pickPreviewLayers prefers blocking layers", () => {
    const preview = pickPreviewLayers(bearishRows, "Bearish", 3);
    expect(preview.some((r) => r.key === "internals")).toBe(true);
    expect(preview.length).toBeGreaterThan(0);
  });

  test("pickCollapsedLayerPreview includes supportive and blocking", () => {
    const preview = pickCollapsedLayerPreview(bearishRows, "Bearish", 2, 2);
    expect(preview.some((r) => r.key === "technical")).toBe(true);
    expect(preview.some((r) => r.key === "internals" || r.key === "sector")).toBe(true);
  });

  test("buildLayerInsightLine avoids generic close-state copy", () => {
    const line = buildLayerInsightLine(
      {
        key: "technical",
        name: "Technical",
        status: "Bearish",
        explanation: "Technical shows the most recent close-state reading.",
        score: 40
      },
      "Bearish"
    );
    expect(line).not.toMatch(/close-state reading/i);
    expect(line).toMatch(/structure/i);
  });

  test("buildSignalsPageDecision monitor state", () => {
    const d = buildSignalsPageDecision({
      bias: "Bearish",
      rows: bearishRows,
      signalScore: 62,
      alignmentRatio: 0.55,
      riskReward: 2.4,
      rrWarning: false,
      isComplete: true
    });
    expect(d.state).toBe("monitor");
    expect(actionableHeadline(d.state)).toMatch(/No actionable setup/);
  });

  test("why-not bullets avoid recommendation words", () => {
    const d = buildSignalsPageDecision({
      bias: "Bearish",
      rows: bearishRows,
      signalScore: 45,
      alignmentRatio: 0.33,
      riskReward: 1.2,
      rrWarning: true,
      isComplete: true
    });
    const bullets = buildWhyNotBullets(d, pickPreviewLayers(bearishRows, "Bearish", 3), "Bearish", 3);
    const joined = bullets.join(" ").toLowerCase();
    expect(joined).not.toMatch(/buy|sell|consider|watch closely|near miss/);
  });

  test("layerPolarity blocking when internals oppose bearish", () => {
    expect(layerPolarity(bearishRows[5]!, "Bearish")).toBe("blocking");
  });

  test("layerDeltaVsBaseline uses neutral baseline", () => {
    expect(SIGNAL_LAYER_LEVEL_BASELINE).toBe(50);
    expect(layerDeltaVsBaseline(60)).toBe(10);
    expect(layerDeltaVsBaseline(40)).toBe(-10);
    expect(layerDeltaVsBaseline(null)).toBeNull();
  });

  test("formatDeltaVsBaselineShort", () => {
    expect(formatDeltaVsBaselineShort(10)).toBe("+10 Δ today");
    expect(formatDeltaVsBaselineShort(-3.2)).toBe("-3.2 Δ today");
    expect(formatDeltaVsBaselineShort(0)).toBe("~0 Δ today");
    expect(formatDeltaVsBaselineShort(0.02)).toBe("~0 Δ today");
  });
});
