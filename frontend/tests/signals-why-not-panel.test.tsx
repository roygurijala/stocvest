import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SignalsWhyNotPanel } from "@/components/signals/signals-why-not-panel";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";
import type { SignalsLayerRowInput } from "@/lib/signals-page-present";

vi.mock("@/lib/theme-provider", () => ({
  useTheme: () => ({
    colors: {
      surface: "#111",
      surfaceMuted: "#1a1a1a",
      border: "#333",
      text: "#eee",
      textMuted: "#999",
      bullish: "#22c55e",
      bearish: "#ef4444",
      caution: "#f59e0b",
      accent: "#3b82f6"
    },
    theme: "dark"
  })
}));

const row = (key: string, name: string): SignalsLayerRowInput => ({
  key,
  name,
  status: "Bullish",
  explanation: "Sample layer detail for preview.",
  score: 72
});

const monitorDecision: TradeDecision = {
  state: "monitor",
  line: "Final confirmation not yet satisfied",
  reinforcements: ["Daily and weekly timeframes diverge."],
  rationale: {
    category: "readiness",
    label: "Why hold:",
    text: "Signal readiness is not yet decisive across the six layers. The setup does not meet internal thresholds for structured scenario building."
  }
};

describe("SignalsWhyNotPanel", () => {
  test("mirrors Execution KPI headline and surfaces primary gate", () => {
    render(
      <SignalsWhyNotPanel
        decision={monitorDecision}
        previewLayers={[row("technical", "Technical")]}
        bias="Bullish"
        causalNarrativeOnPage
      />
    );
    expect(screen.getByTestId("signals-why-not-headline")).toHaveTextContent("Not actionable yet");
    expect(screen.getByTestId("signals-why-not-primary-gate")).toHaveTextContent(/Primary gate · Signal readiness/i);
    expect(screen.getByTestId("signals-why-not-supporting-gates")).toHaveTextContent(
      /Daily and weekly timeframes diverge/i
    );
    expect(screen.queryByTestId("signals-why-not-layer-preview")).toBeNull();
  });

  test("risk/reward gate shows once without Also in play or Additional context repeats", () => {
    const rrDecision: TradeDecision = {
      state: "monitor",
      line: "Monitor",
      reinforcements: ["Risk/reward too low (0.5:1) — below swing desk threshold (2.0:1)."],
      rationale: {
        category: "risk_reward",
        label: "Why hold:",
        text: "Risk/reward too low (0.5:1) — below threshold; does not meet internal thresholds for structured scenario building."
      }
    };
    render(
      <SignalsWhyNotPanel
        decision={rrDecision}
        previewLayers={[row("technical", "Technical")]}
        bias="Bullish"
        causalNarrativeOnPage
      />
    );
    const primary = screen.getByTestId("signals-why-not-primary-gate");
    expect(primary).toHaveTextContent(/0\.5:1/);
    expect(primary).toHaveTextContent(/swing desk threshold \(2\.0:1\)/);
    expect(primary).toHaveTextContent(/structured scenario building/);
    expect(screen.queryByTestId("signals-why-not-supporting-gates")).toBeNull();
    expect(screen.queryByTestId("signals-why-not-layer-preview")).toBeNull();
  });
});
