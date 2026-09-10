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

  test("forwards per-layer reasoning + technical indicator values as layer_details", () => {
    const richRows = [
      {
        key: "technical",
        name: "Technical",
        status: "Bullish" as const,
        explanation: "Weekly close above SMA-50 and SMA-200.",
        reasoning: "Weekly close above SMA-50 and SMA-200 — durable uptrend.",
        chips: ["Golden cross", "Near 52w high"],
        indicatorSnapshot: { sma50: 123.45, sma200: 110.1, golden_cross: true },
        score: 70
      },
      { key: "sector", name: "Sector", status: "Bearish" as const, explanation: "Sector lagging SPY.", score: 42 }
    ];
    const ctx = buildSignalsPageAssistantContext({
      tradingMode: "position",
      symbol: "AMD",
      symbolCommitted: true,
      hasValidSignal: true,
      compositeLoading: false,
      isInsufficientComposite: false,
      pageDecision: monitorDecision,
      signalsPresentRows: richRows,
      setupBias: "Bullish",
      compositeAlignmentRatio: 0.55,
      layerAgreementPercent: 55,
      setupJudgment: null,
      compositeResult: compositeLoaded,
      gapIntelSnapshot: null,
      signalEvidence: null
    });
    const tech = ctx?.layer_details?.find((d) => d.key === "technical");
    expect(tech?.reasoning).toContain("durable uptrend");
    expect(tech?.chips).toEqual(["Golden cross", "Near 52w high"]);
    expect(tech?.indicators).toContain("sma50: $123.45");
    expect(tech?.indicators).toContain("sma200: $110.10");
    // Non-technical layers carry reasoning (from explanation) but no indicator values.
    const sector = ctx?.layer_details?.find((d) => d.key === "sector");
    expect(sector?.reasoning).toContain("lagging SPY");
    expect(sector?.indicators).toBeUndefined();
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

  test("honors a custom pageId (Trading Room deep dive) while keeping full depth", () => {
    const ctx = buildSignalsPageAssistantContext({
      pageId: "dashboard/trading-room",
      tradingMode: "day",
      symbol: "intc",
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
    expect(ctx?.page).toBe("dashboard/trading-room");
    expect(ctx?.trading_mode).toBe("day");
    expect(ctx?.symbol).toBe("INTC");
    expect(ctx?.analysis_status).toBe("loaded");
    expect(ctx?.decision_state).toBe("monitor");
    expect(ctx?.layer_status?.technical).toBe("Bullish");
  });

  test("defaults pageId to signals/layers when omitted", () => {
    const ctx = buildSignalsPageAssistantContext({
      tradingMode: "swing",
      symbol: "AMD",
      symbolCommitted: false,
      hasValidSignal: false,
      compositeLoading: false,
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
    expect(ctx?.page).toBe("signals/layers");
  });
});
