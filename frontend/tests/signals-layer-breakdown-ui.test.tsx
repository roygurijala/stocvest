import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { SignalsLayerBreakdown } from "@/components/signals/signals-layer-breakdown";
import type { SignalsLayerRowInput } from "@/lib/signals-page-present";

vi.mock("@/components/info-tip", () => ({
  InfoTip: () => null
}));

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
  { key: "internals", name: "Market Internals", status: "Bullish", explanation: "", score: 58 }
];

describe("SignalsLayerBreakdown", () => {
  test("renders force summary and bias-anchored role headlines", () => {
    render(
      <SignalsLayerBreakdown
        symbol="TSLA"
        tradingMode="swing"
        bias="Bearish"
        rows={rows}
        loading={false}
        insufficient={false}
      />
    );
    expect(screen.getByTestId("signals-layer-force-summary")).toBeInTheDocument();
    expect(screen.getByTestId("signals-layer-force-with-bias")).toHaveTextContent(/Technical/);
    expect(screen.getByTestId("signals-layer-force-against")).toHaveTextContent(/Internals/);
    expect(screen.getByTestId("signals-layer-row-internals")).toHaveTextContent(/conflicts with bearish thesis/i);
  });

  test("renders News/Geo sensitivity chip when band is present", () => {
    const sensitivityRows: SignalsLayerRowInput[] = [
      { key: "technical", name: "Technical", status: "Neutral", explanation: "", score: 50 },
      {
        key: "news",
        name: "News",
        status: "Neutral",
        explanation: "",
        score: 50,
        sensitivityBand: "low",
        sensitivityMultiplier: 0.6
      },
      { key: "macro", name: "Macro", status: "Neutral", explanation: "", score: 50 },
      { key: "sector", name: "Sector", status: "Neutral", explanation: "", score: 50 },
      {
        key: "geopolitical",
        name: "Geopolitical",
        status: "Neutral",
        explanation: "",
        score: 50,
        sensitivityBand: "high",
        sensitivityMultiplier: 1.0
      },
      { key: "internals", name: "Market Internals", status: "Neutral", explanation: "", score: 50 }
    ];
    render(
      <SignalsLayerBreakdown
        symbol="NEE"
        tradingMode="swing"
        bias="Neutral"
        rows={sensitivityRows}
        loading={false}
        insufficient={false}
        defaultExpanded
      />
    );
    expect(screen.getByTestId("signals-layer-sensitivity-news")).toHaveTextContent(/LOW · 0\.6× weight/i);
    expect(screen.getByTestId("signals-layer-sensitivity-geopolitical")).toHaveTextContent(/HIGH · 1× weight/i);
  });

  test("renders sector technical calibration chip for non-normal regimes", () => {
    const rows: SignalsLayerRowInput[] = [
      {
        key: "technical",
        name: "Technical",
        status: "Bullish",
        explanation: "",
        score: 60,
        techVolRegime: "high_beta",
        techRvolMultiplier: 1.2,
        techOverboughtMultiplier: 0.7
      },
      { key: "news", name: "News", status: "Neutral", explanation: "", score: 50 },
      { key: "macro", name: "Macro", status: "Neutral", explanation: "", score: 50 },
      { key: "sector", name: "Sector", status: "Neutral", explanation: "", score: 50 },
      { key: "geopolitical", name: "Geopolitical", status: "Neutral", explanation: "", score: 50 },
      { key: "internals", name: "Market Internals", status: "Neutral", explanation: "", score: 50 }
    ];
    render(
      <SignalsLayerBreakdown
        symbol="NVDA"
        tradingMode="swing"
        bias="Bullish"
        rows={rows}
        loading={false}
        insufficient={false}
        defaultExpanded
      />
    );
    expect(screen.getByTestId("signals-layer-tech-calibration")).toHaveTextContent(/HIGH-BETA CAL/i);
  });

  test("shows neutral-band caption when a layer carries verdict thresholds", () => {
    const bandRows: SignalsLayerRowInput[] = [
      { key: "technical", name: "Technical", status: "Neutral", explanation: "", score: 50 },
      { key: "news", name: "News", status: "Neutral", explanation: "", score: 50 },
      { key: "macro", name: "Macro", status: "Neutral", explanation: "", score: 46 },
      {
        key: "sector",
        name: "Sector",
        status: "Neutral",
        explanation: "",
        score: 62,
        bullishThreshold: 65,
        bearishThreshold: 35
      },
      {
        key: "geopolitical",
        name: "Geopolitical",
        status: "Neutral",
        explanation: "",
        score: 58,
        bullishThreshold: 60,
        bearishThreshold: 35
      },
      { key: "internals", name: "Market Internals", status: "Neutral", explanation: "", score: 43 }
    ];
    render(
      <SignalsLayerBreakdown
        symbol="APGE"
        tradingMode="swing"
        bias="Neutral"
        rows={bandRows}
        loading={false}
        insufficient={false}
        defaultExpanded
      />
    );
    const sectorRow = screen.getByTestId("signals-layer-row-sector");
    expect(sectorRow).toHaveTextContent(/Neutral band/i);
    expect(sectorRow).toHaveTextContent(/≥65/);
    expect(sectorRow).toHaveTextContent(/no directional edge/i);
  });

  test("hides sector technical calibration chip for normal regime", () => {
    const rows: SignalsLayerRowInput[] = [
      {
        key: "technical",
        name: "Technical",
        status: "Neutral",
        explanation: "",
        score: 50,
        techVolRegime: "normal",
        techRvolMultiplier: 1.0,
        techOverboughtMultiplier: 1.0
      },
      { key: "news", name: "News", status: "Neutral", explanation: "", score: 50 },
      { key: "macro", name: "Macro", status: "Neutral", explanation: "", score: 50 },
      { key: "sector", name: "Sector", status: "Neutral", explanation: "", score: 50 },
      { key: "geopolitical", name: "Geopolitical", status: "Neutral", explanation: "", score: 50 },
      { key: "internals", name: "Market Internals", status: "Neutral", explanation: "", score: 50 }
    ];
    render(
      <SignalsLayerBreakdown
        symbol="KO"
        tradingMode="swing"
        bias="Neutral"
        rows={rows}
        loading={false}
        insufficient={false}
        defaultExpanded
      />
    );
    expect(screen.queryByTestId("signals-layer-tech-calibration")).not.toBeInTheDocument();
  });
});
