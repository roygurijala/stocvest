/**
 * Dual-desk dashboard: both desks appear as status lines (not full panels).
 */

import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";

import { DashboardRedesign } from "@/components/dashboard-redesign";
import { ThemeProvider } from "@/lib/theme-provider";
import type { MarketOverview, MarketStatusPayload } from "@/lib/api/market";
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

describe("dashboard two-desk status (focus layout)", () => {
  test("system_banner_lists_swing_and_day_desk_lines", () => {
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
    const banner = screen.getByTestId("dashboard-system-state-banner");
    expect(banner.textContent || "").toMatch(/Swing Desk/i);
    expect(banner.textContent || "").toMatch(/Day Desk/i);
  });

  test("scanner_shortcut_row_lists_swing_link_before_day_link_in_dom_order", () => {
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
    const desk = screen.getByTestId("dashboard-desk-status");
    const anchors = Array.from(desk.querySelectorAll("a")) as HTMLAnchorElement[];
    const swingIdx = anchors.findIndex((a) => a.getAttribute("href") === "/dashboard/scanner?mode=swing");
    const dayIdx = anchors.findIndex((a) => a.getAttribute("href") === "/dashboard/scanner?mode=day");
    expect(swingIdx).toBeGreaterThan(-1);
    expect(dayIdx).toBeGreaterThan(-1);
    expect(swingIdx).toBeLessThan(dayIdx);
  });

  test("shared_market_context_is_compact_strip_without_role_master_card", () => {
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
    const sc = screen.getByTestId("shared-context-master-card");
    expect(sc.getAttribute("data-shared-layout")).toBe("strip");
    expect(sc.hasAttribute("data-card-role")).toBe(false);
  });

  test("view_day_scanner_link_is_present", () => {
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
    const link = screen.getByRole("link", { name: /day scanner/i });
    expect(link).toHaveAttribute("href", "/dashboard/scanner?mode=day");
  });
});
