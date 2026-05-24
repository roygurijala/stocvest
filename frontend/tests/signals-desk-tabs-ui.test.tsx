import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SignalsDeskVerdictRow } from "@/components/signals/signals-desk-verdict-row";
import { SignalsDeskTabNav } from "@/components/signals/signals-desk-tab-nav";
import { buildSignalsDeskVerdict } from "@/lib/signals-desk-kpi-present";
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
  { key: "technical", name: "Technical", status: "Bearish", explanation: "", score: 40 },
  { key: "news", name: "News", status: "Neutral", explanation: "", score: 50 },
  { key: "macro", name: "Macro", status: "Neutral", explanation: "", score: 50 },
  { key: "sector", name: "Sector", status: "Bearish", explanation: "", score: 35 },
  { key: "geopolitical", name: "Geopolitical", status: "Neutral", explanation: "", score: 50 },
  { key: "internals", name: "Internals", status: "Bullish", explanation: "", score: 58 }
];

describe("Signals desk tab UI", () => {
  test("verdict row fires bias, alignment, and execution navigation", () => {
    const onSelect = vi.fn();
    const verdict = buildSignalsDeskVerdict({
      bias: "Bearish",
      rows,
      tradingMode: "swing",
      decision: {
        state: "monitor",
        line: "Held",
        reinforcements: [],
        rationale: null
      }
    });
    render(
      <SignalsDeskVerdictRow
        items={verdict.items}
        activeTab="setup"
        biasProof={verdict.biasProof}
        executionHint={verdict.executionHint}
        decisionState="monitor"
        onSelectTarget={onSelect}
      />
    );
    fireEvent.click(screen.getByTestId("signals-desk-kpi-alignment"));
    expect(onSelect).toHaveBeenCalledWith("alignment");
    fireEvent.click(screen.getByTestId("signals-desk-kpi-bias"));
    expect(onSelect).toHaveBeenCalledWith("bias");
    fireEvent.click(screen.getByTestId("signals-desk-verdict-execution"));
    expect(onSelect).toHaveBeenCalledWith("execution");
  });

  test("tab nav highlights active panel", () => {
    const onTab = vi.fn();
    render(<SignalsDeskTabNav activeTab="layers" onTabChange={onTab} />);
    expect(screen.getByTestId("signals-desk-tab-layers")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByTestId("signals-desk-tab-evolution"));
    expect(onTab).toHaveBeenCalledWith("evolution");
  });
});
