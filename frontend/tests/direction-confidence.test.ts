import { describe, expect, test } from "vitest";

import {
  parseDirectionConfidence,
  deriveDirectionConfidence,
  directionConfidenceTone,
  directionConfidenceFallbackReason,
} from "@/lib/signal-evidence/direction-confidence";
import { parseSwingCompositeInsight } from "@/lib/signal-evidence";

describe("direction-confidence helper (B79)", () => {
  test("parses the API token case-insensitively", () => {
    expect(parseDirectionConfidence("High")).toBe("High");
    expect(parseDirectionConfidence("moderate")).toBe("Moderate");
    expect(parseDirectionConfidence("LOW")).toBe("Low");
    expect(parseDirectionConfidence("nonsense")).toBeNull();
    expect(parseDirectionConfidence(null)).toBeNull();
  });

  test("derive: High needs all three dimensions to clear their bars", () => {
    expect(
      deriveDirectionConfidence({ score: 0.42, alignmentRatio: 0.8, confidence: 0.7, isNeutral: false })
    ).toBe("High");
  });

  test("derive: neutral is always Low", () => {
    expect(
      deriveDirectionConfidence({ score: 0.9, alignmentRatio: 1, confidence: 1, isNeutral: true })
    ).toBe("Low");
  });

  test("derive: layer disagreement caps at Moderate", () => {
    expect(
      deriveDirectionConfidence({ score: 0.5, alignmentRatio: 0.55, confidence: 0.8, isNeutral: false })
    ).toBe("Moderate");
  });

  test("derive: thin conviction drops to Low", () => {
    expect(
      deriveDirectionConfidence({ score: 0.1, alignmentRatio: 0.9, confidence: 0.9, isNeutral: false })
    ).toBe("Low");
  });

  test("derive: works from a 0..100 signal score", () => {
    // 71 -> directional ~0.42 conviction.
    expect(
      deriveDirectionConfidence({ signalScore0to100: 71, alignmentRatio: 0.8, confidence: 0.7, isNeutral: false })
    ).toBe("High");
  });

  test("tone + fallback reason cover all tiers", () => {
    expect(directionConfidenceTone("High")).toBe("strong");
    expect(directionConfidenceTone("Moderate")).toBe("moderate");
    expect(directionConfidenceTone("Low")).toBe("weak");
    expect(directionConfidenceFallbackReason("High", false)).toMatch(/strong/i);
    expect(directionConfidenceFallbackReason("Low", true)).toMatch(/neutral/i);
  });
});

describe("parseSwingCompositeInsight surfaces direction_confidence", () => {
  test("prefers the API value when present", () => {
    const insight = parseSwingCompositeInsight({
      signal_score: 70,
      trend_direction: "Uptrend",
      direction_confidence: "High",
      direction_confidence_score: 82,
      direction_confidence_reason: "Strong, well-aligned read.",
    });
    expect(insight?.direction_confidence).toBe("High");
    expect(insight?.direction_confidence_score).toBe(82);
    expect(insight?.direction_confidence_reason).toMatch(/well-aligned/);
  });

  test("falls back to a derived tier when the API omits it", () => {
    const insight = parseSwingCompositeInsight({
      score: 0.42,
      signal_score: 71,
      trend_direction: "Uptrend",
      alignment_ratio: 0.8,
      signal_strength: 0.7,
    });
    expect(insight?.direction_confidence).toBe("High");
    expect(insight?.direction_confidence_reason).toBeTruthy();
  });
});
