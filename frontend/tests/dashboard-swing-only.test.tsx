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

describe("Dashboard Swing Desk (top half of the two-desk layout)", () => {
  test("test_swing_desk_shows_empty_state_when_no_swing_setups", () => {
    // The dashboard now ALSO renders a Day Desk below the Swing Desk
    // (Mode Separation B28 Phase 1). An intraday setup in the scanner
    // payload renders inside the Day Desk panel — NOT inside the Swing
    // Desk. This test guards the Swing Desk's empty-state copy and
    // confirms the intraday setup does NOT leak into the Swing surface.
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
    // Phase C added an Active Signal Ribbon above the desks that also
    // renders an "Open scanner" link when there are no firing signals
    // OR no chip data, so the swing-desk empty-state's CTA is matched
    // by the swing panel's own scanner link explicitly via test id /
    // scoping. We assert the swing panel's "Open Scanner" link is
    // present and points at the scanner.
    const swingPanel = screen.getByTestId("swing-desk-panel");
    const swingScannerLinks = Array.from(swingPanel.querySelectorAll("a")).filter((a) =>
      /open scanner/i.test(a.textContent || "")
    );
    expect(swingScannerLinks.length).toBeGreaterThan(0);
    expect(swingScannerLinks[0]!.getAttribute("href")).toBe("/dashboard/scanner");

    // The intraday setup MUST appear inside the Day Desk panel — the
    // dashboard is a dual-desk surface and intraday rows are no longer
    // dropped. This is the Phase-1 contract: data partition by
    // scanner_mode produces TWO desks fed by ONE scanner payload.
    const dayDesk = screen.getByTestId("day-desk-panel");
    expect(dayDesk).toBeInTheDocument();
    expect(dayDesk.querySelector('[data-testid="day-desk-signals"]')).not.toBeNull();
    // The symbol is rendered inside the Day Desk's signal section.
    // (The Active Signal Ribbon also renders this symbol as a chip,
    // so we scope the lookup to the Day Desk panel.)
    expect((dayDesk.textContent || "")).toContain("INTRADAY");
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
    // Phase C — the Active Signal Ribbon also renders the symbol as a
    // chip ABOVE the desks. Scope the assertions to the swing desk
    // panel itself so the test doesn't trip over the (intentional)
    // duplicate render in the ribbon.
    const swingPanel = screen.getByTestId("swing-desk-panel");
    const swingText = swingPanel.textContent || "";
    expect(swingText).toContain("AAA");
    expect(swingText).toContain("BBB");
    expect(swingText).toMatch(/Pattern maturity: 3 sessions/i);
  });
});
