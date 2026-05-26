/**
 * Dashboard structure lock-ins after the focus-layout redesign.
 * Heavy desk grid / ribbon tests retired — those surfaces moved to Scanner.
 */

import type { ReactElement } from "react";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";

import { DashboardRedesign } from "@/components/dashboard-redesign";
import { ThemeProvider } from "@/lib/theme-provider";
import type { MarketOverview, MarketStatusPayload } from "@/lib/api/market";
import type { ScannerOverview } from "@/lib/api/scanner";

vi.mock("@/lib/hooks/use-is-mobile-layout", () => ({
  useIsMobileLayout: () => false
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() })
}));

vi.mock("@/lib/hooks/use-dashboard-desk-refresh", () => ({
  useDashboardDeskRefresh: () => ({
    data: null,
    isLoading: false,
    isValidating: false,
    error: null,
    mutate: vi.fn(),
    refreshDesk: vi.fn(),
    manualRefreshBusy: false,
    canManualRefresh: true,
    cooldownRemainingMs: 0,
    cooldownLabel: null,
    refreshError: null
  })
}));

vi.mock("@/lib/assistant/context", () => ({
  usePublishAssistantContext: () => {}
}));

vi.mock("@/lib/hooks/use-macro-context", () => ({
  useMacroContext: () => ({ data: null })
}));

vi.mock("@/lib/hooks/use-dashboard-payload", () => ({
  useDashboardPayload: () => ({ data: null })
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

const baseScanner: ScannerOverview = {
  gapIntelligence: [],
  setups: [],
  spyPct: 0.1,
  qqqPct: 0.1,
  regimeLabel: "Neutral"
};

const baseWeekly = [
  { symbol: "SPY", label: "Large cap", pct5d: 1, lastPrice: 500 },
  { symbol: "QQQ", label: "Tech / growth", pct5d: 1, lastPrice: 400 },
  { symbol: "IWM", label: "Small cap", pct5d: 1, lastPrice: 200 }
];

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

afterEach(() => {
  cleanup();
});

describe("Dashboard focus shell", () => {
  test("no_desks_grid_or_signal_ribbon_master_cards", () => {
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={baseScanner}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    expect(screen.queryByTestId("dashboard-desks-grid")).toBeNull();
    expect(screen.queryByTestId("dashboard-active-signal-ribbon")).toBeNull();
  });

  test("discovery_and_watchlist_deep_links_present", () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/watchlists/default/symbols")) {
        return new Response(JSON.stringify({ symbols: [] }), { status: 200 });
      }
      if (url.includes("/maturation-summary")) {
        return new Response(JSON.stringify({ mode: "day", by_symbol: {} }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={baseScanner}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    expect(screen.getByTestId("dashboard-discovery-scanner-link").getAttribute("href")).toContain(
      "/dashboard/scanner"
    );
    expect(screen.getByTestId("dashboard-watchlist-radar-link").getAttribute("href")).toContain(
      "/dashboard/watchlists"
    );
  });

  test("watchlist_radar_empty_when_no_attention_symbols", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/watchlists/default/symbols")) {
        return new Response(JSON.stringify({ symbols: ["ZZZ"] }), { status: 200 });
      }
      if (url.includes("/maturation-summary")) {
        return new Response(
          JSON.stringify({
            mode: "day",
            by_symbol: { ZZZ: { symbol: "ZZZ", layers_aligned: 0, layers_total: 6, state: "not_aligned" } }
          }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={{ ...baseScanner, watchlistStatus: null }}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    const radar = screen.getByTestId("dashboard-watchlist-radar");
    await vi.waitFor(() => {
      expect(radar.textContent || "").toMatch(/nothing on your list needs attention/i);
    });
  });
});
