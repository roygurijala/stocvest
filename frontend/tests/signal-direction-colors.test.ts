import { describe, expect, test } from "vitest";

import {
  feedBiasColor,
  layerStatusColor,
  polarityTrendIconKind
} from "@/lib/signal-direction-colors";

const palette = {
  bullish: "#22c55e",
  bearish: "#ef4444",
  textMuted: "#94a3b8"
};

describe("signal-direction-colors", () => {
  test("layerStatusColor maps bullish bearish neutral", () => {
    expect(layerStatusColor("Bullish", palette)).toBe(palette.bullish);
    expect(layerStatusColor("Bearish", palette)).toBe(palette.bearish);
    expect(layerStatusColor("Neutral", palette)).toBe(palette.textMuted);
    expect(layerStatusColor("Mixed", palette)).toBe(palette.textMuted);
  });

  test("feedBiasColor maps bull bear neutral", () => {
    expect(feedBiasColor("bull", palette)).toBe(palette.bullish);
    expect(feedBiasColor("bear", palette)).toBe(palette.bearish);
    expect(feedBiasColor("neutral", palette)).toBe(palette.textMuted);
  });

  test("polarityTrendIconKind understands supportive and blocking", () => {
    expect(polarityTrendIconKind("supportive")).toBe("up");
    expect(polarityTrendIconKind("blocking")).toBe("down");
    expect(polarityTrendIconKind("neutral")).toBe("flat");
  });
});
