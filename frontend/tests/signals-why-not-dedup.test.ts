import { describe, expect, test } from "vitest";
import { buildWhyNotBullets } from "@/lib/signals-page-present";
import {
  buildCausalNarrativeFromRows,
  causalBulletsForWhyNot
} from "@/lib/signal-evidence/causal-narrative";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";
import type { SignalsLayerRowInput } from "@/lib/signals-page-present";

function row(
  key: string,
  name: string,
  status: SignalsLayerRowInput["status"],
  explanation = ""
): SignalsLayerRowInput {
  return { key, name, status, explanation, score: 50 };
}

const monitorDecision: TradeDecision = {
  state: "monitor",
  line: "Decision: Monitor",
  reinforcements: ["Mixed layer alignment (48%).", "Risk/Reward below minimum threshold (1.4 : 1)."],
  rationale: {
    category: "confirmation",
    label: "Why hold:",
    text: "Layer agreement is mixed across the six signal layers."
  }
};

describe("Why not vs causal narrative deduplication", () => {
  test("gate bullets differ from causal summary when narrative panel is shown", () => {
    const narrative = buildCausalNarrativeFromRows({
      signalSummary: "bearish",
      rows: [
        row("internals", "Market Internals", "Bearish", "Internals 60/100 — VIX component 50."),
        row("sector", "Sector", "Neutral", "Sector IHI +4.35% vs SPY."),
        row("technical", "Technical", "Bearish"),
        row("macro", "Macro", "Neutral"),
        row("news", "News", "Neutral"),
        row("geopolitical", "Geopolitical", "Neutral")
      ]
    });
    const causalBullets = causalBulletsForWhyNot(narrative, 4);
    const gateBullets = buildWhyNotBullets(monitorDecision, [], "Bearish", 4, null);

    expect(causalBullets[0]).toBe(narrative.summary);
    expect(gateBullets[0]).toBe(monitorDecision.rationale!.text);
    expect(gateBullets.some((b) => b.includes("Mixed layer alignment"))).toBe(true);
    expect(gateBullets.some((b) => b === narrative.summary)).toBe(false);
  });

  test("causal fallback still used when no separate narrative panel", () => {
    const narrative = buildCausalNarrativeFromRows({
      signalSummary: "bearish",
      rows: [
        row("internals", "Market Internals", "Bearish", "Internals 60/100 — VIX component 50."),
        row("sector", "Sector", "Neutral", "Sector IHI +4.35% vs SPY."),
        row("technical", "Technical", "Bearish"),
        row("macro", "Macro", "Neutral"),
        row("news", "News", "Neutral"),
        row("geopolitical", "Geopolitical", "Neutral")
      ]
    });
    const causalBullets = causalBulletsForWhyNot(narrative, 3);
    const merged = buildWhyNotBullets(monitorDecision, [], "Bearish", 3, causalBullets);
    expect(merged[0]).toBe(narrative.summary);
  });
});
