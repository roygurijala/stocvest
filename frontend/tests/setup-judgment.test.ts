import { describe, expect, test } from "vitest";
import { deriveSetupJudgment, parseSetupJudgment } from "@/lib/signal-evidence/setup-judgment";
import type { SignalsLayerRowInput } from "@/lib/signals-page-present";

function row(key: string, status: SignalsLayerRowInput["status"], score = 70): SignalsLayerRowInput {
  return {
    key,
    name: key,
    status,
    explanation: "",
    score
  };
}

describe("setup-judgment", () => {
  test("parseSetupJudgment reads API payload", () => {
    const j = parseSetupJudgment({
      setup_judgment: {
        process: { tier: "near_ready", label: "Near ready", layers_aligned: 4, layers_total: 6 },
        setup_phase: { id: "extended", label: "Extended" },
        tradeability: {
          band: "weak",
          label: "Weak entry timing",
          flags: [{ id: "rsi_extended", label: "RSI 78", severity: "block" }]
        },
        primary_blocker: "RSI 78 — extended",
        watch_for: "Pullback toward SMA50"
      }
    });
    expect(j?.process.layersAligned).toBe(4);
    expect(j?.setupPhase?.id).toBe("extended");
    expect(j?.tradeability.band).toBe("weak");
  });

  test("deriveSetupJudgment flags extended RSI from technical reasoning", () => {
    const rows = [
      row("technical", "Bullish"),
      row("news", "Bullish"),
      row("macro", "Bullish"),
      row("sector", "Bullish"),
      row("geopolitical", "Neutral", 40),
      row("internals", "Bearish", 35)
    ];
    const j = deriveSetupJudgment({
      mode: "swing",
      rows,
      bias: "Bullish",
      technicalReasoning: "Daily RSI 78 — overbought; Price 16% above SMA50 — extended vs medium-term mean."
    });
    expect(j.process.tier).toBe("near_ready");
    expect(j.tradeability.band).toBe("weak");
    expect(j.primaryBlocker).toMatch(/RSI|above SMA50/i);
  });
});
