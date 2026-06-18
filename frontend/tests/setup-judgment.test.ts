import { describe, expect, test } from "vitest";
import {
  deriveSetupJudgment,
  parseSetupJudgment,
  resolveSetupJudgmentFromComposite
} from "@/lib/signal-evidence/setup-judgment";
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

  test("resolveSetupJudgmentFromComposite reconciles overstated neutral layer progress", () => {
    const rows: SignalsLayerRowInput[] = [
      { key: "internals", name: "Market Internals", status: "Bullish", explanation: "", score: 62 },
      { key: "technical", name: "Technical", status: "Neutral", explanation: "", score: 55 },
      { key: "news", name: "News", status: "Neutral", explanation: "", score: 50 },
      { key: "macro", name: "Macro", status: "Neutral", explanation: "", score: 52 },
      { key: "sector", name: "Sector", status: "Neutral", explanation: "", score: 48 },
      { key: "geopolitical", name: "Geopolitical", status: "Neutral", explanation: "", score: 45 }
    ];
    const j = resolveSetupJudgmentFromComposite(
      {
        signal_summary: "neutral",
        directional_layers_aligned: 1,
        consistency_layers_aligned: 5,
        layers_total: 6,
        setup_judgment: {
          process: { tier: "actionable", label: "Strong", layers_aligned: 6, layers_total: 6 },
          tradeability: { band: "weak", label: "Weak entry timing", flags: [] },
          primary_blocker: null,
          watch_for: null
        }
      },
      { mode: "swing", rows, bias: "Neutral", alignmentRatio: 1 }
    );
    expect(j?.process.layersAligned).toBe(1);
    expect(j?.process.label).not.toBe("Strong");
  });
});
