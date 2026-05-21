import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}));
import { SignalsSetupRead } from "@/components/signals/signals-setup-read";
import type { SignalsLayerRowInput } from "@/lib/signals-page-present";
import type { FundamentalBackdropSummary } from "@/lib/signal-evidence/fundamental-present";
import { buildScenarioGeometryBundle } from "@/lib/scenario/scenario-variants";

vi.mock("@/components/info-tip", () => ({
  InfoTip: () => null
}));

vi.mock("@/components/signal-disclaimer-chip", () => ({
  SignalDisclaimerChip: () => <span data-testid="signal-disclaimer-chip" />
}));

vi.mock("@/components/upgrade-prompt", () => ({
  UpgradePrompt: () => <span data-testid="upgrade-prompt">Upgrade</span>
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
          line: "Final confirmation and/or risk conditions not yet satisfied",
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
    expect(screen.getByTestId("signals-setup-alignment")).toHaveTextContent("Developing (2/6)");
    expect(screen.queryByText("Layer evidence")).not.toBeInTheDocument();
    expect(screen.queryByText("Past states")).not.toBeInTheDocument();
    expect(screen.queryByText(/AI Signal Analysis/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Setup read/i)).toBeInTheDocument();
    expect(screen.getByTestId("signals-setup-execution")).toHaveTextContent("Not actionable yet");
    expect(screen.getByTestId("signals-why-not")).toBeInTheDocument();
    expect(screen.queryByText(/Review on Watchlist/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Monitor progression/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/View setup evolution/i)).not.toBeInTheDocument();
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/consider|watch closely|near miss|buy|sell/i);
  });

  test("renders fundamental backdrop when summary provided", () => {
    const summary: FundamentalBackdropSummary = {
      headline: "Fundamental backdrop: Weak",
      backdrop: "weak",
      bullets: ["Revenue trend declining", "No positive catalyst"],
      convictionNote: "Setup may still meet layer rules, but fundamental backdrop is weak — conviction is lower, not blocked."
    };
    render(
      <SignalsSetupRead
        symbol="TSLA"
        tradingMode="swing"
        bias="Bullish"
        rows={rows}
        previewLayers={rows.slice(0, 2)}
        decision={{
          state: "actionable",
          line: "Layers aligned for a bullish swing read",
          reinforcements: [],
          rationale: null
        }}
        fundamentalSummary={summary}
      />
    );
    expect(screen.getByTestId("signals-fundamental-backdrop")).toBeInTheDocument();
    expect(screen.getByText(/Fundamental backdrop: Weak/i)).toBeInTheDocument();
    expect(screen.getByText(/conviction is lower/i)).toBeInTheDocument();
  });


  test("renders scenario adjust when geometry provided", () => {
    const geometryBundle = buildScenarioGeometryBundle({
      bias: "Bullish",
      entryZoneLow: 299,
      entryZoneHigh: 302,
      last: 301.2,
      structuralStop: 297.48,
      target1: 302.8,
      target2: 306.5,
      systemRiskReward: 0.5,
      maturationState: "developing",
      layersAligned: 3,
      compositeStopProvided: true,
      compositeTargetProvided: true,
      compositeZoneProvided: true
    });
    render(
      <SignalsSetupRead
        symbol="AAPL"
        tradingMode="swing"
        bias="Bullish"
        rows={rows}
        previewLayers={rows.slice(0, 2)}
        decision={{
          state: "monitor",
          line: "Held",
          reinforcements: [],
          rationale: {
            category: "risk_reward",
            label: "Why hold:",
            text: "Risk/reward too low (0.5:1) — below threshold."
          }
        }}
        scenarioGeometryBundle={geometryBundle}
      />
    );
    expect(screen.getByTestId("signals-scenario-adjust")).toBeInTheDocument();
    expect(screen.getByTestId("signals-setup-execution")).toHaveTextContent("Not actionable yet");
  });

  test("execution detail toggle reveals primary blocker", () => {
    render(
      <SignalsSetupRead
        symbol="AAPL"
        tradingMode="swing"
        bias="Bullish"
        rows={rows}
        previewLayers={rows.slice(0, 2)}
        decision={{
          state: "monitor",
          line: "Final confirmation and/or risk conditions not yet satisfied",
          reinforcements: [],
          rationale: {
            category: "risk_reward",
            label: "Why hold:",
            text: "Risk/reward too low (0.5:1) — below threshold."
          }
        }}
        alignmentRatio={1}
      />
    );
    expect(screen.getByTestId("signals-setup-execution-detail-toggle")).toHaveTextContent(
      /One condition remains/
    );
    expect(screen.queryByTestId("signals-setup-execution-detail")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("signals-setup-execution-detail-toggle"));
    expect(screen.getByTestId("signals-setup-execution-detail")).toHaveTextContent(/Risk\/reward too low/);
  });

  test("renders fundamental upgrade slot when requested", () => {
    render(
      <SignalsSetupRead
        symbol="TSLA"
        tradingMode="swing"
        bias="Bullish"
        rows={rows}
        previewLayers={rows.slice(0, 2)}
        decision={{
          state: "monitor",
          line: "No actionable setup",
          reinforcements: [],
          rationale: null
        }}
        showFundamentalUpgrade
      />
    );
    expect(screen.getByTestId("signals-fundamental-backdrop-upgrade")).toBeInTheDocument();
    expect(screen.getByTestId("upgrade-prompt")).toBeInTheDocument();
  });
});
