import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SignalsBiasRationalePanel } from "@/components/signals/signals-bias-rationale-panel";
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

const rows: SignalsLayerRowInput[] = [
  { key: "technical", name: "Technical", status: "Bullish", explanation: "", score: 95 },
  { key: "sector", name: "Sector", status: "Bullish", explanation: "", score: 80 },
  { key: "internals", name: "Market Internals", status: "Bullish", explanation: "", score: 70 },
  { key: "news", name: "News", status: "Neutral", explanation: "", score: 50 },
  { key: "macro", name: "Macro", status: "Neutral", explanation: "", score: 50 },
  { key: "geopolitical", name: "Geopolitical", status: "Neutral", explanation: "", score: 50 }
];

describe("SignalsBiasRationalePanel", () => {
  test("mirrors Bias KPI headline and explains layer split", () => {
    render(<SignalsBiasRationalePanel bias="Bullish" rows={rows} signalSummary="bullish" />);
    expect(screen.getByTestId("signals-bias-rationale-headline")).toHaveTextContent("Bullish");
    expect(screen.getByTestId("signals-bias-rationale")).toHaveTextContent(/Bullish read from composite/i);
    expect(screen.getByTestId("signals-layer-force-with-bias")).toHaveTextContent(/Technical/);
    expect(screen.getByTestId("signals-bias-rationale")).toHaveAttribute(
      "id",
      "signals-section-bias-rationale"
    );
  });
});
