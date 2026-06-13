import { describe, expect, test } from "vitest";
import { enrichSignalsDeskAssistantContext } from "@/lib/assistant/signals-desk-assistant-context";
import type { AssistantPageContext } from "@/lib/assistant/types";

const base: AssistantPageContext = {
  page: "signals/layers",
  trading_mode: "swing",
  symbol: "D",
  decision_state: "monitor",
  analysis_status: "loaded"
};

const rows = [
  { key: "technical", name: "Technical", status: "Bullish" as const, explanation: "", score: 70 },
  { key: "news", name: "News", status: "Bullish" as const, explanation: "", score: 65 },
  { key: "macro", name: "Macro", status: "Neutral" as const, explanation: "", score: 50 },
  { key: "sector", name: "Sector", status: "Bullish" as const, explanation: "", score: 68 },
  { key: "geopolitical", name: "Geopolitical", status: "Neutral" as const, explanation: "", score: 50 },
  { key: "internals", name: "Market Internals", status: "Bullish" as const, explanation: "", score: 72 }
];

describe("enrichSignalsDeskAssistantContext", () => {
  test("forwards desk verdict fields visible on Signals page", () => {
    const enriched = enrichSignalsDeskAssistantContext(base, {
      setupBias: "Bullish",
      rows,
      alignmentRatio: 5 / 6,
      maturationState: "strong",
      maturationLabel: "Strong (5/6)",
      tradingMode: "swing",
      decision: {
        state: "monitor",
        line: "Final confirmation not yet satisfied",
        reinforcements: [
          "The short-term and longer-term trend are pointing in different directions — that's a caution flag."
        ],
        rationale: {
          category: "readiness",
          label: "Why hold:",
          text:
            "Not enough signals agree yet. We need more layers to align before this becomes a trade worth considering."
        }
      }
    });
    expect(enriched.setup_bias).toBe("Bullish");
    expect(enriched.alignment_display).toContain("Near ready");
    expect(enriched.alignment_display).toContain("4/6");
    expect(enriched.execution_readiness_label).toBe("Not actionable yet");
    expect(enriched.decision_reinforcements?.[0]).toContain("caution flag");
    expect(enriched.maturation_label).toBe("Strong (5/6)");
    expect(enriched.execution_hint).toBeTruthy();
  });
});
