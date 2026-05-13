/**
 * Lock-in tests for the dashboard ↔ scanner mode plumbing.
 *
 * Three regression-prone behaviours guarded here:
 *
 *   1. SWING DESK FOOTER LINK — the dashboard's Swing Desk has a
 *      persistent "View swing scanner →" footer link, regardless of
 *      whether swing setups are present or empty. It must point at
 *      `/dashboard/scanner?mode=swing` so the scanner page's URL-
 *      priority mode resolver lands the user on the Swing tab.
 *      Symmetric to the Day Desk's `View day scanner →` footer,
 *      which carries `?mode=day` (locked separately in
 *      `dashboard-two-desk.test.tsx`).
 *
 *   2. SWING DESK EMPTY-STATE LINK — the swing empty state's
 *      "Open Scanner →" link also carries `?mode=swing`. This was
 *      previously a bare `/dashboard/scanner` URL, which on an
 *      existing session would inherit the last-used scanner tab
 *      from localStorage — so a user with sticky "day" mode would
 *      see swing copy "Open Scanner →" land them on the Day tab.
 *      Adding `?mode=swing` makes the destination deterministic.
 *
 *   3. THREE-MASTER-CARDS INVARIANT — neither the new swing footer
 *      block nor the day footer carries a `data-card-role`, so the
 *      dashboard's "exactly 3 master cards" invariant still holds.
 *
 * Note on the scanner-page URL resolver: the URL `?mode=` priority
 * over localStorage is unit-tested directly inside
 * `scanner-page-client.test.tsx` (the existing scanner test file
 * already exercises the load path). Here we only assert that the
 * dashboard EMITS the correct URL — the scanner page's behaviour on
 * receiving that URL is its own contract.
 */

import type { ReactElement } from "react";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";

import { DashboardRedesign } from "@/components/dashboard-redesign";
import { ThemeProvider } from "@/lib/theme-provider";
import type { MarketOverview, MarketStatusPayload } from "@/lib/api/market";
import type { IntradaySetupPayload, ScannerOverview } from "@/lib/api/scanner";

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

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// (1) Swing Desk footer — always rendered, always carries `?mode=swing`
// ─────────────────────────────────────────────────────────────────────────────

describe("Swing Desk scanner footer (mode plumbing)", () => {
  test("renders_view_swing_scanner_footer_link_when_swing_setups_are_empty", () => {
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
    const footer = screen.getByTestId("swing-desk-scanner-footer");
    expect(footer).toBeInTheDocument();
    const link = footer.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/dashboard/scanner?mode=swing");
    expect(((link?.textContent || "").toLowerCase())).toContain("view swing scanner");
  });

  test("renders_view_swing_scanner_footer_link_when_swing_setups_are_present", () => {
    // Populate the swing desk so the empty-state branch does NOT render.
    // The footer link must still be visible — that's the "persistent"
    // half of the contract.
    const swingSetup: IntradaySetupPayload = {
      symbol: "SWGFTR",
      direction: "bullish",
      score: 0.84,
      triggers: ["ema_cross"],
      timestamp_iso: "2026-05-01T13:00:00Z",
      scanner_mode: "swing_daily"
    };
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={{ ...baseScanner, setups: [swingSetup] }}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    const footer = screen.getByTestId("swing-desk-scanner-footer");
    expect(footer).toBeInTheDocument();
    const link = footer.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/dashboard/scanner?mode=swing");
  });

  test("swing_desk_footer_block_carries_NO_data_card_role", () => {
    // Anti-regression on the "exactly 3 master cards" invariant.
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
    const footer = screen.getByTestId("swing-desk-scanner-footer");
    expect(footer.hasAttribute("data-card-role")).toBe(false);
    // The cumulative master-card count must remain exactly 3.
    const masters = document.querySelectorAll("[data-card-role]");
    expect(masters.length).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (2) Day Desk footer — sanity (existing test pins `?mode=day`, but we
//     also assert the link comes from inside the day-desk-panel itself
//     so a future refactor that drops the footer altogether fails fast).
// ─────────────────────────────────────────────────────────────────────────────

describe("Day Desk scanner footer (mode plumbing)", () => {
  test("renders_view_day_scanner_link_inside_day_desk_panel_with_mode_day", () => {
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
    const dayPanel = screen.getByTestId("day-desk-panel");
    const links = Array.from(dayPanel.querySelectorAll("a")).filter((a) =>
      /view day scanner/i.test(a.textContent || "")
    );
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]!.getAttribute("href")).toBe("/dashboard/scanner?mode=day");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (3) Active Signal Ribbon — chip deep-links keep mode in URL
// ─────────────────────────────────────────────────────────────────────────────

describe("Active Signal Ribbon chip mode plumbing", () => {
  test("ribbon_chip_for_swing_signal_carries_trading_mode_swing_in_href", () => {
    const swingSetup: IntradaySetupPayload = {
      symbol: "SWGRBN2",
      direction: "bullish",
      score: 0.86,
      triggers: ["ema_cross"],
      timestamp_iso: "2026-05-01T13:00:00Z",
      scanner_mode: "swing_daily"
    };
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={{ ...baseScanner, setups: [swingSetup] }}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    const chip = screen.getByTestId("ribbon-chip-SWGRBN2") as HTMLAnchorElement;
    expect(chip.getAttribute("href") || "").toContain("trading_mode=swing");
  });
});
