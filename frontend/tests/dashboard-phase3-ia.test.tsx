/**
 * Tier 1.C Phase 3 — discovery row, universe strip, desk posture summary, click hierarchy.
 */

import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { DashboardDiscoveryRow } from "@/components/dashboard/dashboard-discovery-row";
import { DashboardDeskPostureSummary } from "@/components/dashboard/dashboard-desk-posture-summary";
import { DashboardUniverseStrip } from "@/components/dashboard/dashboard-universe-strip";
import { DashboardRedesign } from "@/components/dashboard-redesign";
import { DATA_INTERACTION_LEVEL } from "@/lib/dashboard/click-hierarchy";
import { ThemeProvider } from "@/lib/theme-provider";
import type { MarketOverview, MarketStatusPayload } from "@/lib/api/market";
import type { GapIntelligenceItem } from "@/lib/api/scanner";
import { EMPTY_SCANNER_OVERVIEW } from "@/lib/api/scanner";

vi.mock("@/lib/hooks/use-is-mobile-layout", () => ({
  useIsMobileLayout: () => false
}));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    })
  });
});

function buildMarketStatus(market: string): MarketStatusPayload {
  return { market, exchanges: {}, currencies: {} };
}

const baseMarket: MarketOverview = {
  snapshots: [],
  news: [],
  status: buildMarketStatus("open")
};

const baseWeekly = [
  { symbol: "SPY", label: "Large cap", pct5d: 1, lastPrice: 500 },
  { symbol: "QQQ", label: "Tech / growth", pct5d: 1, lastPrice: 400 },
  { symbol: "IWM", label: "Small cap", pct5d: 1, lastPrice: 200 }
];

const gapA: GapIntelligenceItem = {
  symbol: "GAPAAA",
  company_name: "Gap A Inc",
  gap_pct: 4.2,
  gap_dollars: 2,
  prev_close: 50,
  current_price: 52,
  volume: 1_000_000,
  volume_vs_avg: 2,
  gap_quality_score: 0.9,
  catalyst: { category: "earnings", sentiment: "bullish", headline: "Beat" },
  has_catalyst: true,
  no_catalyst_warning: null
};

const gapB: GapIntelligenceItem = {
  ...gapA,
  symbol: "GAPBBB",
  company_name: "Gap B Inc",
  gap_quality_score: 0.5,
  gap_pct: -3.1,
  has_catalyst: false,
  catalyst: null
};

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

afterEach(() => {
  cleanup();
});

describe("click hierarchy helpers", () => {
  test("interactionLevelProps_sets_data_attribute", async () => {
    const { interactionLevelProps } = await import("@/lib/dashboard/click-hierarchy");
    expect(interactionLevelProps("medium")[DATA_INTERACTION_LEVEL]).toBe("medium");
  });
});

describe("DashboardUniverseStrip", () => {
  test("renders_level_none_and_read_only_counts", () => {
    wrap(
      <DashboardUniverseStrip swingUniverseSymbolCount={250} gapSnapshotSymbolCount={180} />
    );
    const strip = screen.getByTestId("dashboard-universe-strip");
    expect(strip.getAttribute(DATA_INTERACTION_LEVEL)).toBe("none");
    expect(strip.textContent).toContain("250");
    expect(strip.textContent).toContain("180");
  });
});

describe("DashboardDiscoveryRow", () => {
  test("details_expand_lists_leaders_without_navigation", () => {
    wrap(<DashboardDiscoveryRow gapIntelligence={[gapA, gapB]} />);
    const details = screen.getByTestId("dashboard-discovery-details");
    expect(details.getAttribute(DATA_INTERACTION_LEVEL)).toBe("medium");
    expect(screen.getByTestId("discovery-preview-GAPAAA")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/View gap leaders/));
    expect(screen.getByTestId("discovery-leader-GAPAAA")).toBeInTheDocument();
    expect(screen.getByTestId("discovery-leader-GAPBBB")).toBeInTheDocument();
    const link = screen.getByTestId("dashboard-discovery-scanner-link");
    expect(link.getAttribute(DATA_INTERACTION_LEVEL)).toBe("deep");
    expect(link.getAttribute("href")).toContain("/dashboard/scanner");
  });
});

describe("DashboardDeskPostureSummary", () => {
  test("renders_swing_and_day_posture_cards", () => {
    wrap(
      <DashboardDeskPostureSummary
        swingPosture="active"
        dayPosture="monitor"
        showDayDesk
      />
    );
    expect(screen.getByTestId("dashboard-swing-posture-card").getAttribute("data-desk-posture")).toBe(
      "active"
    );
    expect(screen.getByTestId("dashboard-day-posture-card").getAttribute("data-desk-posture")).toBe(
      "monitor"
    );
  });
});

describe("DashboardRedesign Phase 3 integration", () => {
  test("shows_phase3_surfaces_after_scanner_hydrates", () => {
    const overview = {
      ...EMPTY_SCANNER_OVERVIEW,
      setups: [],
      gapIntelligence: [gapA],
      swingUniverseSymbolCount: 100,
      gapIntelligenceSnapshotSymbolCount: 80,
      spyPct: 0.1,
      qqqPct: 0.1
    };

    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={overview}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );

    expect(screen.getByTestId("dashboard-universe-strip")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-discovery-row")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-desk-posture-summary")).toBeInTheDocument();
    const ribbon = screen.getByTestId("dashboard-active-signal-ribbon");
    expect(ribbon.getAttribute("data-ribbon-state")).toBe("empty");
  });

  test("hides_phase3_until_scanner_settles", () => {
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={EMPTY_SCANNER_OVERVIEW}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    expect(screen.queryByTestId("dashboard-universe-strip")).toBeNull();
    expect(screen.queryByTestId("dashboard-discovery-row")).toBeNull();
  });
});
