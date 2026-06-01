/**
 * D13 Phase 2–3 — market pulse hero, discovery feed, watchlist radar on dashboard.
 */

import type { ReactElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { DashboardDiscoveryFeed } from "@/components/dashboard/dashboard-discovery-feed";
import { DashboardMissedTodayStrip } from "@/components/dashboard/dashboard-missed-today-strip";
import { DashboardRedesign } from "@/components/dashboard-redesign";
import { ThemeProvider } from "@/lib/theme-provider";
import type { MarketOverview, MarketStatusPayload } from "@/lib/api/market";
import { EMPTY_SCANNER_OVERVIEW, type GapIntelligenceItem } from "@/lib/api/scanner";
import { nyTradingDateIso } from "@/lib/dashboard/desk-session-freshness";

vi.mock("@/lib/hooks/use-is-mobile-layout", () => ({
  useIsMobileLayout: () => false
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() })
}));

vi.mock("@/lib/hooks/use-dashboard-desk-refresh", () => ({
  useDashboardDeskRefresh: () => ({
    data: {
      mode: "swing",
      source: "cache",
      data: {
        discovery: [
          {
            symbol: "MU",
            gap_percent: 16.2,
            direction: "up",
            rank_score: 16.2,
            desk: "swing",
            execution_hint: "Layers look strong — but risk/reward (0.5:1) is too low to act on yet."
          }
        ],
        eligible_symbol_count: 120,
        scanned_snapshot_count: 4500,
        session_trading_date: deskSessionToday,
        generated_at: `${deskSessionToday}T14:00:00.000Z`
      }
    },
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

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const deskSessionToday = nyTradingDateIso();

const baseMarket: MarketOverview = {
  snapshots: [
    { symbol: "SPY", last_trade_price: 500, change_percent: 0.5, prev_close: 498 },
    { symbol: "QQQ", last_trade_price: 400, change_percent: 0.3, prev_close: 399 }
  ],
  news: [],
  status: { market: "open", exchanges: {}, currencies: {} } as MarketStatusPayload
};

const baseWeekly = [
  { symbol: "SPY", label: "Large cap", pct5d: 1, lastPrice: 500 },
  { symbol: "QQQ", label: "Tech", pct5d: 0.5, lastPrice: 400 },
  { symbol: "IWM", label: "Small cap", pct5d: -0.2, lastPrice: 200 }
];

describe("DashboardDiscoveryFeed", () => {
  test("renders missed today educational strip for recently_hot rows", () => {
    wrap(
      <DashboardMissedTodayStrip
        mode="swing"
        deskData={{
          recently_hot: [{ symbol: "MU", dropped_at: "2026-05-26T14:00:00Z", gap_percent: 16.2 }],
          movers_radar: [{ symbol: "MU", gap_percent: 16.2, direction: "up", rank_score: 16.2 }]
        }}
      />
    );
    expect(screen.getByTestId("dashboard-missed-today")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-missed-today-MU")).toBeInTheDocument();
    expect(screen.getByText(/extended/i)).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-missed-today-link-MU")).toHaveAttribute("href", expect.stringContaining("MU"));
  });

  test("renders market activity card with disclaimer and blocked badge", () => {
    wrap(
      <DashboardDiscoveryFeed
        mode="swing"
        deskData={{
          session_trading_date: deskSessionToday,
          generated_at: `${deskSessionToday}T14:00:00.000Z`,
          rejected_samples: [{ symbol: "NVDA", reason: "gap_below_2.0pct" }],
          rejection_reason_counts: { "gap_below_2.0pct": 12 },
          discovery: [
            {
              symbol: "MU",
              gap_percent: 16.2,
              direction: "up",
              rank_score: 16.2,
              desk: "swing",
              execution_hint: "Layers look strong — but risk/reward (0.5:1) is too low to act on yet."
            }
          ]
        }}
        gapFallback={[]}
      />
    );
    expect(screen.getByText("Market activity")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-opportunity-row-MU")).toBeInTheDocument();
    expect(screen.getByTestId("scanner-why-missing-panel")).toBeInTheDocument();
    expect(screen.getByTestId("opportunity-row-badge-MU")).toHaveTextContent(/R\/R blocks entry/i);
    expect(screen.queryByText(/Signals →/)).toBeNull();
  });
});

describe("DashboardRedesign radar shell", () => {
  test("renders pulse hero discovery feed and watchlist radar", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/watchlists/default/symbols")) {
        return new Response(JSON.stringify({ symbols: ["NVDA"] }), { status: 200 });
      }
      if (url.includes("/maturation-summary")) {
        return new Response(
          JSON.stringify({
            mode: "swing",
            by_symbol: {
              NVDA: {
                symbol: "NVDA",
                layers_aligned: 4,
                layers_total: 6,
                progress_band: "near_ready",
                state: "near_ready"
              }
            }
          }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={{
          ...EMPTY_SCANNER_OVERVIEW,
          regimeLabel: "Risk-on",
          spyPct: 0.5,
          qqqPct: 0.3
        }}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[
          { symbol: "XLK", label: "Tech", pct5d: 1.2 },
          { symbol: "XLE", label: "Energy", pct5d: -0.8 }
        ]}
      />
    );

    expect(screen.getByTestId("dashboard-market-pulse-hero")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-page-title")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-opportunity-pipeline")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-discovery-feed")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-opportunity-row-MU")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-opportunities")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-system-state-banner")).not.toBeInTheDocument();

    await vi.waitFor(() => {
      expect(screen.getByTestId("dashboard-watchlist-radar")).toBeInTheDocument();
    });
  });
});
