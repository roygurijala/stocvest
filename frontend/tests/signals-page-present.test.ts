import { describe, expect, test } from "vitest";
import {
  executionHeadline,
  executionProgressHint,
  strongSetupExecutionBridgeLine,
  buildLayerInsightLine,
  buildSignalsPageDecision,
  buildWhyNotBullets,
  alignedLayersFromAlignmentRatio,
  countLayerAlignment,
  formatDeltaVsBaselineShort,
  formatSignalsAlignmentDisplayLine,
  layerDeltaVsBaseline,
  layerPolarity,
  layerRoleLabel,
  groupLayersByForce,
  buildBiasRationaleIntro,
  buildLayerRoleHeadline,
  formatLayerForceNames,
  normalizeSetupBias,
  pickCollapsedLayerPreview,
  pickPreviewLayers,
  resolveCompositeLayerAlignment,
  resolveSignalsLayerAlignment,
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

  test("resolveCompositeLayerAlignment matches Signals display line", () => {
    const neutralRows: SignalsLayerRowInput[] = bearishRows.map((r) => ({
      ...r,
      status: "Neutral" as const
    }));
    const resolved = resolveCompositeLayerAlignment({
      rows: neutralRows,
      bias: "Neutral",
      alignmentRatio: 0.5
    });
    expect(resolved.aligned).toBe(3);
    expect(resolved.displayLine).toBe("Mixed direction (3/6)");
  });

  test("resolveSignalsLayerAlignment prefers alignment_ratio over chip count", () => {
    const neutralRows: SignalsLayerRowInput[] = bearishRows.map((r) => ({
      ...r,
      status: "Neutral" as const
    }));
    expect(countLayerAlignment(neutralRows, "Neutral").aligned).toBe(6);
    const resolved = resolveSignalsLayerAlignment({
      rows: neutralRows,
      bias: "Neutral",
      alignmentRatio: 0.67
    });
    expect(resolved.aligned).toBe(4);
    expect(formatSignalsAlignmentDisplayLine(resolved, "Neutral")).toBe("Mostly neutral (4/6)");
  });

  test("alignedLayersFromAlignmentRatio rounds to nearest layer", () => {
    expect(alignedLayersFromAlignmentRatio(0.62)).toBe(4);
    expect(alignedLayersFromAlignmentRatio(0.85)).toBe(5);
  });

  test("executionProgressHint skips misleading copy on neutral bias", () => {
    expect(executionProgressHint("monitor", 6, 6, "Neutral")).toBeNull();
  });

  test("countLayerAlignment ignores bullish label without a live layer score", () => {
    const rows: SignalsLayerRowInput[] = [
      { key: "technical", name: "Technical", status: "Bullish", explanation: "", score: 72 },
      { key: "news", name: "News", status: "Bullish", explanation: "", score: null },
      { key: "macro", name: "Macro", status: "Neutral", explanation: "", score: 50 },
      { key: "sector", name: "Sector", status: "Neutral", explanation: "", score: 50 },
      { key: "geopolitical", name: "Geopolitical", status: "Neutral", explanation: "", score: 50 },
      { key: "internals", name: "Internals", status: "Neutral", explanation: "", score: 50 }
    ];
    expect(countLayerAlignment(rows, "Bullish").aligned).toBe(1);
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

  test("groupLayersByForce splits bearish setup into supporting and opposing lists", () => {
    const g = groupLayersByForce(bearishRows, "Bearish");
    expect(g.withBias.map((r) => r.name)).toEqual(expect.arrayContaining(["Technical", "Sector"]));
    expect(g.againstOrMixed.map((r) => r.name)).toContain("Internals");
    expect(formatLayerForceNames(g.withBias)).toMatch(/Technical/);
    expect(g.titles.withBias).toMatch(/supporting bearish bias/i);
  });

  test("buildBiasRationaleIntro summarizes bearish layer split", () => {
    const intro = buildBiasRationaleIntro("Bearish", bearishRows, "bearish");
    expect(intro).toMatch(/bearish/i);
    expect(intro).toMatch(/support/i);
  });

  test("layerRoleLabel is bias-anchored", () => {
    expect(layerRoleLabel("supportive", "Bullish")).toMatch(/supports bullish thesis/i);
    expect(layerRoleLabel("blocking", "Bullish")).toMatch(/conflicts with bullish thesis/i);
    expect(layerRoleLabel("neutral", "Bearish")).toMatch(/no edge/i);
  });

  test("buildLayerRoleHeadline combines status and role", () => {
    const line = buildLayerRoleHeadline(
      { key: "news", name: "News", status: "Bullish", explanation: "", score: 72 },
      "Bullish"
    );
    expect(line).toMatch(/Strong bullish read/i);
    expect(line).toMatch(/supports bullish thesis/i);
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

  test("buildSignalsPageDecision assigns B+ conviction for 1.6 R/R and 5/6 swing", () => {
    const rows: SignalsLayerRowInput[] = [
      { key: "technical", name: "Technical", status: "Bullish", explanation: "", score: 72 },
      { key: "news", name: "News", status: "Bullish", explanation: "", score: 68 },
      { key: "macro", name: "Macro", status: "Bullish", explanation: "", score: 65 },
      { key: "sector", name: "Sector", status: "Bullish", explanation: "", score: 70 },
      { key: "geopolitical", name: "Geopolitical", status: "Neutral", explanation: "", score: 52 },
      { key: "internals", name: "Internals", status: "Bullish", explanation: "", score: 66 }
    ];
    const d = buildSignalsPageDecision({
      mode: "swing",
      bias: "Bullish",
      rows,
      signalScore: 65,
      alignmentRatio: 0.85,
      riskReward: 1.6,
      rrWarning: false,
      isComplete: true
    });
    expect(d.state).toBe("monitor");
    expect(d.conviction?.tier).toBe("b_plus");
  });

  test("buildSignalsPageDecision monitor state", () => {
    const d = buildSignalsPageDecision({
      mode: "swing",
      bias: "Bearish",
      rows: bearishRows,
      signalScore: 62,
      alignmentRatio: 0.55,
      riskReward: 2.4,
      rrWarning: false,
      isComplete: true
    });
    expect(d.state).toBe("monitor");
    expect(executionHeadline(d.state)).toMatch(/Setup is forming/);
    expect(d.line).toMatch(/Final confirmation/);
  });

  test("executionProgressHint when strong alignment but monitor gates", () => {
    const bullishAligned: SignalsLayerRowInput[] = [
      { key: "technical", name: "Technical", status: "Bullish", explanation: "", score: 72 },
      { key: "news", name: "News", status: "Bullish", explanation: "", score: 68 },
      { key: "macro", name: "Macro", status: "Bullish", explanation: "", score: 65 },
      { key: "sector", name: "Sector", status: "Bullish", explanation: "", score: 70 },
      { key: "geopolitical", name: "Geopolitical", status: "Neutral", explanation: "", score: 52 },
      { key: "internals", name: "Internals", status: "Bullish", explanation: "", score: 66 }
    ];
    const a = countLayerAlignment(bullishAligned, "Bullish");
    expect(a.aligned).toBeGreaterThanOrEqual(5);
    const d = buildSignalsPageDecision({
      mode: "swing",
      bias: "Bullish",
      rows: bullishAligned,
      signalScore: 88,
      alignmentRatio: 0.92,
      riskReward: 2.1,
      rrWarning: false,
      isComplete: true
    });
    expect(executionProgressHint("monitor", a.aligned, a.total, "Bullish", d)).toMatch(/One condition remains/);
  });

  test("strongSetupExecutionBridgeLine when strong alignment and R/R blocks", () => {
    const rows: SignalsLayerRowInput[] = [
      { key: "technical", name: "Technical", status: "Bullish", explanation: "", score: 95 },
      { key: "news", name: "News", status: "Bullish", explanation: "", score: 89 },
      { key: "macro", name: "Macro", status: "Bullish", explanation: "", score: 65 },
      { key: "sector", name: "Sector", status: "Bullish", explanation: "", score: 80 },
      { key: "geopolitical", name: "Geopolitical", status: "Bullish", explanation: "", score: 55 },
      { key: "internals", name: "Internals", status: "Bullish", explanation: "", score: 60 }
    ];
    const d = buildSignalsPageDecision({
      mode: "swing",
      bias: "Bullish",
      rows,
      signalScore: 90,
      alignmentRatio: 1.0,
      riskReward: 0.5,
      rrWarning: false,
      isComplete: true
    });
    const a = countLayerAlignment(rows, "Bullish");
    const line = strongSetupExecutionBridgeLine("monitor", a.aligned, a.total, "Bullish", d);
    expect(line).toMatch(/Strong setup quality/);
    expect(line).toMatch(/0\.5:1/);
    expect(executionProgressHint("monitor", a.aligned, a.total, "Bullish", d)).toBe(line);
  });

  test("why-not bullets avoid recommendation words", () => {
    const d = buildSignalsPageDecision({
      mode: "swing",
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
