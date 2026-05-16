import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SignalsSetupRead } from "@/components/signals/signals-setup-read";
import type { SignalsLayerRowInput } from "@/lib/signals-page-present";

vi.mock("@/components/info-tip", () => ({
  InfoTip: () => null
}));

vi.mock("@/components/signal-disclaimer-chip", () => ({
  SignalDisclaimerChip: () => <span data-testid="signal-disclaimer-chip" />
}));

vi.mock("@/lib/theme-provider", () => ({
  useTheme: () => ({
    colors: {
      surface: "#111",
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

const rows: SignalsLayerRowInput[] = [
  { key: "technical", name: "Technical", status: "Bearish", explanation: "", score: 40 },
  { key: "news", name: "News", status: "Neutral", explanation: "", score: 50 },
  { key: "macro", name: "Macro", status: "Neutral", explanation: "", score: 50 },
  { key: "sector", name: "Sector", status: "Bearish", explanation: "", score: 35 },
  { key: "geopolitical", name: "Geopolitical", status: "Neutral", explanation: "", score: 50 },
  { key: "internals", name: "Internals", status: "Bullish", explanation: "", score: 58 }
];

describe("SignalsSetupRead", () => {
  test("renders setup read without AI Signal Analysis heading", () => {
    render(
      <SignalsSetupRead
        symbol="TSLA"
        tradingMode="swing"
        bias="Bearish"
        rows={rows}
        previewLayers={rows.slice(0, 2)}
        decision={{
          state: "monitor",
          line: "No actionable setup — confirmation and/or risk gates not fully cleared",
          reinforcements: [],
          rationale: {
            category: "confirmation",
            label: "Why hold:",
            text: "Layer agreement is mixed across the six signal layers."
          }
        }}
      />
    );
    expect(screen.getByTestId("signals-setup-read")).toBeInTheDocument();
    expect(screen.getByTestId("signals-setup-bias")).toHaveTextContent("Bearish");
    expect(screen.getByTestId("signals-setup-alignment")).toHaveTextContent("2 / 6");
    expect(screen.queryByText(/AI Signal Analysis/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Setup read/i)).toBeInTheDocument();
    expect(screen.getByTestId("signals-why-not")).toBeInTheDocument();
    expect(screen.getByTestId("signals-next")).toBeInTheDocument();
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/consider|watch closely|near miss|buy|sell/i);
  });
});
