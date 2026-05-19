import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LaggardInsight } from "@/components/signal/LaggardInsight";
import { UnlockForecast } from "@/components/analytics/UnlockForecast";
import { LaggardScanner } from "@/components/scanner/LaggardScanner";
import { ThemeProvider } from "@/lib/theme-provider";
import type { LaggardSignal, UnlockHint } from "@/lib/laggard";

vi.mock("@/lib/api/user", () => ({
  useHasAIExplanations: () => true,
  useUserProfileLoaded: () => true
}));

const sampleSignal: LaggardSignal = {
  symbol: "AVGO",
  has_laggard_signal: true,
  laggard_type: "catch_up",
  driver_type: "sector",
  driver_label: "Semiconductor sector",
  trigger_entity: null,
  confidence: "high",
  laggard_score: 78,
  context: {
    peers_moving: [
      { symbol: "NVDA", move_1d: 4.1 },
      { symbol: "AMD", move_1d: 3.2 }
    ]
  },
  narrative: {
    explanation: "Semiconductor peers advanced while AVGO lagged on the session.",
    what_to_watch: "SOXX holds above +0.8% while AVGO closes within 1% of peer average move."
  }
};

const distributionSignal: LaggardSignal = {
  ...sampleSignal,
  laggard_type: "distribution",
  driver_type: "macro",
  driver_label: "Rate-sensitive growth",
  narrative: {
    explanation: "Rate-sensitive names recovered but AVGO stayed weak on elevated volume.",
    what_to_watch: "Peer recovery holds while AVGO fails to reclaim the group move."
  }
};

const preIpoSignal: LaggardSignal = {
  ...sampleSignal,
  driver_type: "pre_ipo_proxy",
  driver_label: "OpenAI ecosystem",
  trigger_entity: "OpenAI"
};

const dynamicSignal: LaggardSignal = {
  ...sampleSignal,
  driver_type: "dynamic_cluster",
  driver_label: "Dynamic cluster: RKLB"
};

const unlockHints: UnlockHint[] = [
  {
    layer_name: "sector",
    layer_label: "Sector",
    distance_description: "Sector persistence 0.58 — about 0.02 below target.",
    trigger_condition: "SOXX relative strength holds while persistence reaches 0.6.",
    estimated_sessions: 1,
    confidence: "high",
    is_primary_blocker: true
  }
];

function wrap(ui: React.ReactNode) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("LaggardInsight", () => {
  test("returns null for day mode", () => {
    const { container } = wrap(<LaggardInsight signal={sampleSignal} isPaid mode="day" />);
    expect(container.firstChild).toBeNull();
  });

  test("returns null when no signal", () => {
    const { container } = wrap(
      <LaggardInsight signal={{ symbol: "X", has_laggard_signal: false }} isPaid mode="swing" />
    );
    expect(container.firstChild).toBeNull();
  });

  test("shows driver label for paid swing", () => {
    wrap(<LaggardInsight signal={sampleSignal} isPaid mode="swing" />);
    expect(screen.getByTestId("laggard-insight-panel")).toBeTruthy();
    expect(screen.getByTestId("laggard-driver-badge")).toHaveTextContent(/Semiconductor sector/i);
  });

  test("free user sees upgrade gate", () => {
    wrap(<LaggardInsight signal={sampleSignal} isPaid={false} mode="swing" />);
    expect(screen.getByTestId("laggard-insight-upgrade")).toBeTruthy();
  });

  test("catch_up uses green type badge", () => {
    wrap(<LaggardInsight signal={sampleSignal} isPaid mode="swing" />);
    expect(screen.getByTestId("laggard-type-catch_up")).toHaveTextContent(/Catch-up/i);
  });

  test("pre_breakout uses amber treatment", () => {
    wrap(<LaggardInsight signal={{ ...sampleSignal, laggard_type: "pre_breakout" }} isPaid mode="swing" />);
    expect(screen.getByTestId("laggard-type-pre_breakout")).toHaveTextContent(/Pre-breakout/i);
  });

  test("distribution red treatment without opportunity copy", () => {
    wrap(<LaggardInsight signal={distributionSignal} isPaid mode="swing" />);
    expect(screen.getByTestId("laggard-type-distribution")).toHaveTextContent(/Distribution/i);
    expect(screen.getByText(/bearish divergence/i)).toBeTruthy();
    expect(screen.queryByText(/opportunity/i)).toBeNull();
  });

  test("pre_ipo_proxy shows trigger entity", () => {
    wrap(<LaggardInsight signal={preIpoSignal} isPaid mode="swing" />);
    expect(screen.getByTestId("laggard-trigger-entity")).toHaveTextContent(/OpenAI/i);
  });

  test("dynamic_cluster shows cluster label", () => {
    wrap(<LaggardInsight signal={dynamicSignal} isPaid mode="swing" />);
    expect(screen.getByTestId("laggard-driver-badge")).toHaveTextContent(/Dynamic cluster/i);
  });
});

describe("UnlockForecast", () => {
  test("hidden when empty and not fetchable", () => {
    const { container } = wrap(<UnlockForecast hints={[]} />);
    expect(container.firstChild).toBeNull();
  });

  test("shows primary blocker when hints provided", () => {
    wrap(<UnlockForecast hints={unlockHints} />);
    fireEvent.click(screen.getByRole("button", { name: /What would unlock/i }));
    expect(screen.getByTestId("unlock-forecast-primary")).toHaveTextContent(/Sector/i);
    expect(screen.getByText(/SOXX relative strength/i)).toBeTruthy();
  });
});

describe("LaggardScanner", () => {
  test("empty paid scan hides section entirely", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ scanned: 12, laggards_found: 0, laggards: [] })
      })
    );
    const { container } = wrap(<LaggardScanner visible />);
    await vi.waitFor(() => {
      expect(container.querySelector("[data-testid='laggard-scanner']")).toBeNull();
    });
    expect(screen.queryByTestId("laggard-scanner-empty")).toBeNull();
    vi.unstubAllGlobals();
  });
});
