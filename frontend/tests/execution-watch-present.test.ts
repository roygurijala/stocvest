import { describe, expect, test } from "vitest";
import {
  mergeExecutionDeskHints,
  resolveExecutionWatchHint
} from "@/lib/signal-evidence/execution-watch-present";
import { deriveSetupJudgment } from "@/lib/signal-evidence/setup-judgment";
import { buildExecutionHeaderHint } from "@/lib/signals-desk-kpi-present";
import type { SignalsLayerRowInput } from "@/lib/signals-page-present";

const rows: SignalsLayerRowInput[] = [
  { key: "technical", name: "Technical", status: "Bullish", explanation: "RSI 72 — extended momentum", score: 78 },
  { key: "news", name: "News", status: "Neutral", explanation: "", score: 50 },
  { key: "macro", name: "Macro", status: "Bullish", explanation: "", score: 60 },
  { key: "sector", name: "Sector", status: "Bullish", explanation: "", score: 65 },
  { key: "geopolitical", name: "Geopolitical", status: "Neutral", explanation: "", score: 50 },
  { key: "internals", name: "Market Internals", status: "Neutral", explanation: "", score: 52 }
];

describe("resolveExecutionWatchHint", () => {
  test("uses watchFor from setup judgment", () => {
    const judgment = deriveSetupJudgment({
      mode: "swing",
      rows,
      bias: "Bullish",
      alignmentRatio: 0.55,
      technicalReasoning: "RSI 72 — extended momentum"
    });
    const hint = resolveExecutionWatchHint(judgment, "Bullish", "monitor");
    expect(hint).toBeTruthy();
    expect(hint).toMatch(/pullback|extended/i);
  });

  test("neutral bias without technical phase still guides next step", () => {
    const hint = resolveExecutionWatchHint(null, "Neutral", "monitor");
    expect(typeof hint).toBe("string");
    expect(hint).toMatch(/layers to agree/i);
  });
});

describe("buildExecutionHeaderHint with setup judgment", () => {
  test("appends watch line under Not actionable for extended bullish desk", () => {
    const judgment = deriveSetupJudgment({
      mode: "swing",
      rows,
      bias: "Bullish",
      alignmentRatio: 0.85,
      technicalReasoning: "RSI 74 — extended"
    });
    const hint = buildExecutionHeaderHint(
      {
        state: "monitor",
        line: "Waiting",
        reinforcements: ["Risk/reward too low (0.5:1) — below swing desk threshold (2.0:1)."],
        rationale: {
          category: "risk_reward",
          label: "Why hold:",
          text: "The reward doesn't justify the risk at 0.5:1 (below our minimum)."
        }
      },
      "swing",
      5,
      6,
      "Bullish",
      true,
      judgment
    );
    expect(hint).toBeTruthy();
    expect(hint).toMatch(/pullback|extended|desk can clear/i);
  });
});

describe("mergeExecutionDeskHints", () => {
  test("skips duplicate watch tail", () => {
    const merged = mergeExecutionDeskHints(
      "Layers look strong — but risk/reward (0.5:1) is too low to act on yet.",
      "Extended trend — wait for a pullback before the desk can clear"
    );
    expect(merged).toContain("risk/reward");
    expect(merged).toContain("pullback");
  });
});
