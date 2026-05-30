import { describe, expect, test } from "vitest";
import { buildSignalsPageAssistantContext } from "@/lib/assistant/build-signals-assistant-context";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";

const rows = [
  { key: "technical", name: "Technical", status: "Bullish" as const, explanation: "", score: 70 },
  { key: "news", name: "News", status: "Neutral" as const, explanation: "", score: 55 },
  { key: "macro", name: "Macro", status: "Bullish" as const, explanation: "", score: 65 },
  { key: "sector", name: "Sector", status: "Bullish" as const, explanation: "", score: 68 },
  { key: "geopolitical", name: "Geopolitical", status: "Neutral" as const, explanation: "", score: 50 },
  { key: "internals", name: "Market Internals", status: "Bearish" as const, explanation: "", score: 42 }
];

const monitorDecision: TradeDecision = {
  state: "monitor",
  line: "Waiting on more layer agreement and/or better risk/reward",
  reinforcements: ["Layers don't agree enough across the desk."],
  rationale: {
    category: "confirmation",
    label: "Why hold:",
    text: "The layers don't fully agree on direction yet. More need to line up before this becomes a trade worth considering."
  }
};

const compositeLoaded = {
  signal_score: 62,
  signal_strength: 0.62,
  alignment_ratio: 0.55,
  risk_reward: 1.8,
  trend_strength: "Moderate",
  trend_direction: "Uptrend",
  market_regime: "Neutral",
  is_complete: true,
  layers: []
};

describe("buildSignalsPageAssistantContext", () => {
  test("publishes loaded desk context from composite when Evidence modal was never opened", () => {
    const ctx = buildSignalsPageAssistantContext({
      tradingMode: "swing",
      symbol: "AMD",
      symbolCommitted: true,
      hasValidSignal: true,
      compositeLoading: false,
      isInsufficientComposite: false,
      pageDecision: monitorDecision,
      signalsPresentRows: rows,
      setupBias: "Bullish",
      compositeAlignmentRatio: 0.55,
      layerAgreementPercent: 55,
      setupJudgment: null,
      compositeResult: compositeLoaded,
      gapIntelSnapshot: null,
      signalEvidence: null
    });
    expect(ctx?.analysis_status).toBe("loaded");
    expect(ctx?.decision_state).toBe("monitor");
    expect(ctx?.decision_rationale?.text).toContain("don't fully agree");
    expect(ctx?.layer_status?.technical).toBe("Bullish");
    expect(ctx?.layer_status?.internals).toBe("Bearish");
    expect(ctx?.alignment_display).toBeTruthy();
    expect(ctx?.execution_readiness_label).toBe("Not actionable yet");
  });

  test("marks loading only when composite fetch is in flight", () => {
    const ctx = buildSignalsPageAssistantContext({
      tradingMode: "swing",
      symbol: "AMD",
      symbolCommitted: true,
      hasValidSignal: false,
      compositeLoading: true,
      isInsufficientComposite: false,
      pageDecision: null,
      signalsPresentRows: [],
      setupBias: "Neutral",
      compositeAlignmentRatio: null,
      layerAgreementPercent: null,
      setupJudgment: null,
      compositeResult: null,
      gapIntelSnapshot: null,
      signalEvidence: null
    });
    expect(ctx?.analysis_status).toBe("loading");
    expect(ctx?.decision_state).toBeUndefined();
  });
});
