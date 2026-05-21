import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { SignalsScenarioAdjust } from "@/components/signals/signals-scenario-adjust";
import { buildScenarioGeometryBundle } from "@/lib/scenario/scenario-variants";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";

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

const geometryBundle = buildScenarioGeometryBundle({
  bias: "Bullish",
  entryZoneLow: 299,
  entryZoneHigh: 302,
  last: 301.2,
  structuralStop: 297.48,
  target1: 302.8,
  target2: 306.5,
  vwap: 300.5,
  systemRiskReward: 0.5,
  maturationState: "developing",
  layersAligned: 3,
  compositeStopProvided: true,
  compositeTargetProvided: true,
  compositeZoneProvided: true
})!;

const monitorRrDecision: TradeDecision = {
  state: "monitor",
  line: "Final confirmation and/or risk conditions not yet satisfied",
  reinforcements: ["Risk/reward too low (0.5:1) — below threshold."],
  rationale: {
    category: "risk_reward",
    label: "Why hold:",
    text: "Risk/reward too low (0.5:1) — below threshold."
  }
};

describe("SignalsScenarioAdjust", () => {
  test("renders system R/R and opens adjust panel", () => {
    render(<SignalsScenarioAdjust systemDecision={monitorRrDecision} geometryBundle={geometryBundle} />);
    expect(screen.getByTestId("signals-scenario-adjust")).toBeInTheDocument();
    expect(screen.getByTestId("signals-scenario-system-rr")).toHaveTextContent(/0\.5/);
    expect(screen.getByTestId("signals-scenario-adjust-panel")).toBeInTheDocument();
  });

  test("aggressive preset updates result R/R without mutating system line", () => {
    render(<SignalsScenarioAdjust systemDecision={monitorRrDecision} geometryBundle={geometryBundle} />);
    fireEvent.click(screen.getByTestId("signals-scenario-preset-aggressive"));
    const result = screen.getByTestId("signals-scenario-result-rr");
    expect(result.textContent).toMatch(/✓|2\./);
    expect(screen.getByTestId("signals-scenario-system-rr")).toHaveTextContent(/0\.5/);
    expect(screen.getByTestId("signals-scenario-exec-summary")).toHaveTextContent(/clear the risk\/reward gate/i);
  });
});
