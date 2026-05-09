import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";

import { DashboardRedesign } from "@/components/dashboard-redesign";
import { ThemeProvider } from "@/lib/theme-provider";
import type { MarketOverview } from "@/lib/api/market";
import type { ScannerOverview } from "@/lib/api/scanner";

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

const baseMarket: MarketOverview = {
  snapshots: [
    { symbol: "SPY", last_trade_price: 500, prev_close: 498 },
    { symbol: "QQQ", last_trade_price: 400, prev_close: 398 }
  ],
  news: [],
  status: { market: "open", exchanges: {}, currencies: {} }
};

const baseScanner: ScannerOverview = {
  gapIntelligence: [],
  setups: [],
  spyPct: 0.1,
  qqqPct: 0.1,
  regimeLabel: "Neutral"
};

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("Dashboard swing-only Top Signals", () => {
  test("test_dashboard_shows_empty_state_when_no_swing_setups", () => {
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={{
          ...baseScanner,
          setups: [
            {
              symbol: "INTRADAY",
              direction: "long",
              score: 0.9,
              triggers: ["orb_breakout_long"],
              timestamp_iso: "2026-05-01T14:30:00Z"
            }
          ]
        }}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={[
          { symbol: "SPY", label: "Large cap", pct5d: 1, lastPrice: 500 },
          { symbol: "QQQ", label: "Tech / growth", pct5d: 1, lastPrice: 400 },
          { symbol: "IWM", label: "Small cap", pct5d: 1, lastPrice: 200 }
        ]}
        sectorRotation={[]}
      />
    );
    expect(screen.getByText(/No active swing setups right now/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Scanner/i })).toHaveAttribute("href", "/dashboard/scanner");
    expect(screen.queryByText("INTRADAY")).not.toBeInTheDocument();
  });

  test("test_dashboard_shows_swing_setups_when_available", () => {
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={{
          ...baseScanner,
          setups: [
            {
              symbol: "AAA",
              direction: "bullish",
              score: 0.88,
              triggers: ["ema50_cross_above_200"],
              timestamp_iso: "2026-05-01T12:00:00Z",
              scanner_mode: "swing_daily",
              pattern_maturity_days: 3
            },
            {
              symbol: "BBB",
              direction: "bullish",
              score: 0.77,
              triggers: ["weekly_rsi_recovery"],
              timestamp_iso: "2026-05-01T12:00:00Z",
              scanner_mode: "swing_daily"
            }
          ]
        }}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={[
          { symbol: "SPY", label: "Large cap", pct5d: 1, lastPrice: 500 },
          { symbol: "QQQ", label: "Tech / growth", pct5d: 1, lastPrice: 400 },
          { symbol: "IWM", label: "Small cap", pct5d: 1, lastPrice: 200 }
        ]}
        sectorRotation={[]}
      />
    );
    expect(screen.getByText("AAA")).toBeInTheDocument();
    expect(screen.getByText("BBB")).toBeInTheDocument();
    expect(screen.getByText(/Pattern maturity: 3 sessions/i)).toBeInTheDocument();
  });
});
