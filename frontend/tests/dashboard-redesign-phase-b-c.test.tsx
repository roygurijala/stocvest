/**
 * Phase B / B+ / C lock-in tests for the dashboard redesign.
 *
 * What these guard:
 *
 *   Phase B1  — Side-by-side desks on `lg+`. We assert the desks
 *               grid wrapper has the `lg:grid-cols-2` class so a
 *               future refactor that swaps to grid-cols-1 globally
 *               would break the lock-in here, not silently regress
 *               the desktop layout.
 *
 *   Phase B2  — Swing Desk visual signature renders inside the
 *               swing card header.
 *
 *   Phase B3  — Day Desk visual signature renders inside the day
 *               card header, with `data-session-phase` derived
 *               from market_status.
 *
 *   Phase B+  — Swing rows carry a "Multi-day" tag, Day rows carry
 *               their intraday meta strip (VWAP-relative chip when
 *               vwap is present).
 *
 *   Phase C   — Active Signal Ribbon renders above the desks,
 *               interleaves swing and day chips, and falls back to
 *               a thoughtful empty state when no signals fire.
 *
 *   Phase C   — Ribbon carries NO `data-card-role` so the
 *               "exactly 3 master cards" invariant still holds.
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
// Phase B1 — Side-by-side desks
// ─────────────────────────────────────────────────────────────────────────────

describe("Phase B1 — Side-by-side desk grid", () => {
  test("desks_grid_uses_lg_grid_cols_2_so_desks_sit_side_by_side_above_1024px", () => {
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
    const grid = screen.getByTestId("dashboard-desks-grid");
    expect(grid).toBeInTheDocument();
    const classes = grid.className;
    // Mobile-first base = 1 column; lg breakpoint flips to 2 columns.
    expect(classes).toMatch(/grid-cols-1/);
    expect(classes).toMatch(/lg:grid-cols-2/);
  });

  test("swing_desk_AND_day_desk_are_both_inside_the_desks_grid", () => {
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
    const grid = screen.getByTestId("dashboard-desks-grid");
    const swing = screen.getByTestId("swing-desk-panel");
    const day = screen.getByTestId("day-desk-panel");
    expect(grid.contains(swing)).toBe(true);
    expect(grid.contains(day)).toBe(true);
    // DOM order preserved (Swing before Day) — the existing
    // `day_desk_follows_swing_desk_in_dom_order_stacked` invariant still
    // applies inside the grid wrapper.
    expect(swing.compareDocumentPosition(day) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase B2 / B3 — Visual signatures inside desk headers
// ─────────────────────────────────────────────────────────────────────────────

describe("Phase B2 / B3 — Desk visual signatures", () => {
  test("swing_desk_renders_its_horizon_signature_inside_the_panel", () => {
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
    const swing = screen.getByTestId("swing-desk-panel");
    const signature = swing.querySelector('[data-testid="swing-desk-signature"]');
    expect(signature).not.toBeNull();
  });

  test("day_desk_renders_its_session_clock_signature_with_session_phase_attribute", () => {
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
    const day = screen.getByTestId("day-desk-panel");
    const signature = day.querySelector('[data-testid="day-desk-signature"]');
    expect(signature).not.toBeNull();
    // Phase attribute is read off the market_status: market=open → "open" or "midday".
    const phase = signature?.getAttribute("data-session-phase");
    expect(["premarket", "open", "midday", "after_hours", "closed"]).toContain(phase || "");
  });

  test("day_desk_signature_phase_is_closed_when_market_is_closed", () => {
    wrap(
      <DashboardRedesign
        marketOverview={{ ...baseMarket, status: buildMarketStatus("closed") }}
        scannerOverview={baseScanner}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    const signature = screen.getByTestId("day-desk-signature");
    expect(signature.getAttribute("data-session-phase")).toBe("closed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase B+ — Mode-specific row metadata
// ─────────────────────────────────────────────────────────────────────────────

describe("Phase B+ — Mode-specific row metadata", () => {
  test("swing_row_carries_multi_day_tag_when_swing_setup_is_present", () => {
    const swingSetup: IntradaySetupPayload = {
      symbol: "SWGAAA",
      direction: "bullish",
      score: 0.85,
      triggers: ["ema_cross", "weekly_rsi_recovery"],
      timestamp_iso: "2026-05-01T14:00:00Z",
      scanner_mode: "swing_daily",
      pattern_maturity_days: 4
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
    const swing = screen.getByTestId("swing-desk-panel");
    const multiday = swing.querySelector('[data-testid="swing-row-multiday-tag"]');
    expect(multiday).not.toBeNull();
    expect((multiday?.textContent || "").toLowerCase()).toContain("multi-day");
  });

  test("day_row_renders_intraday_meta_strip_AND_vwap_chip_when_vwap_is_present", () => {
    const daySetup: IntradaySetupPayload = {
      symbol: "DAYAAA",
      direction: "bullish",
      score: 0.78,
      triggers: ["orb_breakout_long"],
      timestamp_iso: "2026-05-01T14:30:00Z",
      last_price: 105.0,
      vwap: 100.0
    };
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={{ ...baseScanner, setups: [daySetup] }}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    const day = screen.getByTestId("day-desk-panel");
    const meta = day.querySelector('[data-testid="day-row-intraday-meta"]');
    expect(meta).not.toBeNull();
    const vwapChip = day.querySelector('[data-testid="day-row-vwap-chip"]');
    expect(vwapChip).not.toBeNull();
    // 105 > 100 → "above" direction → chip carries the matching attribute.
    expect(vwapChip?.getAttribute("data-vwap-direction")).toBe("above");
    const text = (vwapChip?.textContent || "").toLowerCase();
    expect(text).toContain("above vwap");
  });

  test("day_row_vwap_chip_renders_below_when_last_price_under_vwap", () => {
    const daySetup: IntradaySetupPayload = {
      symbol: "DAYBBB",
      direction: "bearish",
      score: 0.72,
      triggers: ["momentum_short"],
      timestamp_iso: "2026-05-01T14:30:00Z",
      last_price: 95.5,
      vwap: 100.0
    };
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={{ ...baseScanner, setups: [daySetup] }}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    const day = screen.getByTestId("day-desk-panel");
    const vwapChip = day.querySelector('[data-testid="day-row-vwap-chip"]');
    expect(vwapChip?.getAttribute("data-vwap-direction")).toBe("below");
  });

  test("day_row_omits_vwap_chip_gracefully_when_vwap_is_missing", () => {
    const daySetup: IntradaySetupPayload = {
      symbol: "DAYCCC",
      direction: "bullish",
      score: 0.65,
      triggers: ["volume_surge"],
      timestamp_iso: "2026-05-01T14:30:00Z",
      last_price: 50.0
    };
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={{ ...baseScanner, setups: [daySetup] }}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    const day = screen.getByTestId("day-desk-panel");
    expect(day.querySelector('[data-testid="day-row-vwap-chip"]')).toBeNull();
    // The meta wrapper still renders (last-price chip still has content).
    expect(day.querySelector('[data-testid="day-row-intraday-meta"]')).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase C — Active Signal Ribbon
// ─────────────────────────────────────────────────────────────────────────────

describe("Phase C — Active Signal Ribbon", () => {
  test("ribbon_is_NOT_a_master_card_so_the_three_master_card_invariant_holds", () => {
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
    const ribbon = screen.getByTestId("dashboard-active-signal-ribbon");
    expect(ribbon.hasAttribute("data-card-role")).toBe(false);
    // The cumulative count of role elements on the dashboard must still
    // be exactly three (shared, swing, day). Adding the ribbon must not
    // perturb that.
    const masters = document.querySelectorAll("[data-card-role]");
    expect(masters.length).toBe(3);
  });

  test("ribbon_renders_empty_state_with_watching_line_when_no_setups_present", () => {
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={{ ...baseScanner, swingUniverseSymbolCount: 250 }}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    const ribbon = screen.getByTestId("dashboard-active-signal-ribbon");
    expect(ribbon.getAttribute("data-ribbon-state")).toBe("empty");
    expect((ribbon.textContent || "").toLowerCase()).toContain("watching 250 tickers");
  });

  test("ribbon_renders_interleaved_swing_AND_day_chips_when_both_desks_have_signals", () => {
    const swingSetup: IntradaySetupPayload = {
      symbol: "SWGRBN",
      direction: "bullish",
      score: 0.86,
      triggers: ["ema_cross"],
      timestamp_iso: "2026-05-01T13:00:00Z",
      scanner_mode: "swing_daily"
    };
    const daySetup: IntradaySetupPayload = {
      symbol: "DAYRBN",
      direction: "bullish",
      score: 0.78,
      triggers: ["orb_breakout"],
      timestamp_iso: "2026-05-01T14:30:00Z"
    };
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={{ ...baseScanner, setups: [swingSetup, daySetup] }}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    const ribbon = screen.getByTestId("dashboard-active-signal-ribbon");
    expect(ribbon.getAttribute("data-ribbon-state")).toBe("active");
    const swingChip = ribbon.querySelector('[data-testid="ribbon-chip-SWGRBN"]');
    const dayChip = ribbon.querySelector('[data-testid="ribbon-chip-DAYRBN"]');
    expect(swingChip).not.toBeNull();
    expect(dayChip).not.toBeNull();
    // Mode tag per chip.
    expect(swingChip?.getAttribute("data-ribbon-chip-mode")).toBe("swing");
    expect(dayChip?.getAttribute("data-ribbon-chip-mode")).toBe("day");
    // Chip count attribute matches actual chip count (caps at 4 per side).
    expect(ribbon.getAttribute("data-ribbon-chip-count")).toBe("2");
  });

  test("ribbon_chip_link_carries_trading_mode_query_param_matching_chip_mode", () => {
    const daySetup: IntradaySetupPayload = {
      symbol: "DAYLNK",
      direction: "bullish",
      score: 0.78,
      triggers: ["orb_breakout"],
      timestamp_iso: "2026-05-01T14:30:00Z"
    };
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={{ ...baseScanner, setups: [daySetup] }}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    const chip = screen.getByTestId("ribbon-chip-DAYLNK") as HTMLAnchorElement;
    expect(chip.getAttribute("href") || "").toContain("trading_mode=day");
  });
});
