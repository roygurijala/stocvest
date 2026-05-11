/**
 * Dashboard two-desk render — Mode Separation B28 Phase 1 lock-ins.
 *
 * These tests pin the structural rules from the assistant prompt's
 * MODE SEPARATION rendering spec:
 *   - Swing Desk and Day Desk both visible
 *   - Day Desk follows Swing Desk in DOM order (stacked, swing first)
 *   - Equal visual weight (both rendered as DashboardCards, no
 *     class differences that imply hierarchy)
 *   - Day-vocabulary copy on the Day Desk, swing-vocabulary on the
 *     Swing Desk — vocabularies do NOT cross
 *   - Day Desk posture follows session timing + setup presence
 *
 * The dual-desk surface is the trigger for the LLM's Priority 3
 * STRUCTURED DUAL ANSWER routing path. These tests guard the input
 * the routing path depends on. A regression that visually merges the
 * desks or strips one of them is caught here.
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

describe("dashboard two-desk render contract (Mode Separation B28 Phase 1)", () => {
  test("dashboard_renders_swing_desk_AND_day_desk_simultaneously", () => {
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
    const day = screen.getByTestId("day-desk-panel");
    expect(swing).toBeInTheDocument();
    expect(day).toBeInTheDocument();
  });

  test("day_desk_follows_swing_desk_in_dom_order_stacked", () => {
    // The prompt says "stacked, not side-by-side (initially)" and "Swing Desk
    // on top, Day Desk below". DOM order matters because screen readers and
    // tab order follow it. Use Node.DOCUMENT_POSITION_FOLLOWING to assert
    // ordering independently of CSS.
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
    const day = screen.getByTestId("day-desk-panel");
    const rel = swing.compareDocumentPosition(day);
    // Day Desk follows Swing Desk
    expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("weekly_market_context_eyebrow_is_shared_context_NOT_swing_desk", () => {
    // The Weekly market context card is a SHARED input (both desks read it).
    // Its eyebrow must NOT label it as a swing-desk surface — that would imply
    // shared context belongs to one engine, violating the "WHAT MAY BE SHARED
    // ACROSS MODES" rule. We anchor strictly on the eyebrow element (not the
    // whole card body) because the subtitle legitimately names both desks to
    // explain what reads this shared input.
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
    const weekly = screen.getByTestId("shared-market-context-weekly");
    expect(weekly).toBeInTheDocument();
    const eyebrow = weekly.querySelector('[data-testid="dashboard-card-eyebrow"]');
    expect(eyebrow).not.toBeNull();
    const eyebrowText = (eyebrow?.textContent || "").toLowerCase();
    expect(eyebrowText).toContain("shared context");
    expect(eyebrowText).not.toContain("swing desk");
  });

  test("day_desk_posture_when_market_closed_is_suppressed_session_closed", () => {
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
    const day = screen.getByTestId("day-desk-panel");
    expect(day.getAttribute("data-day-desk-posture")).toBe("suppressed_session_closed");
    // Posture pill shows "Suppressed" (not "Active" or "Monitor-only"). Use
    // the data attribute to anchor regardless of glyph/text-transform.
    const pill = screen.getByTestId("day-desk-posture-pill");
    expect(pill.getAttribute("data-day-desk-posture-label")).toBe("suppressed");
    // Day-vocabulary suppression copy is visible (the prompt's mode-aware
    // empty-state language rule). "Session closed" is day vocabulary,
    // NOT swing vocabulary.
    const suppression = screen.getByTestId("day-desk-suppression");
    expect(suppression.textContent || "").toMatch(/session closed/i);
  });

  test("day_desk_posture_when_market_open_no_setups_is_suppressed_no_confirmation", () => {
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
    expect(day.getAttribute("data-day-desk-posture")).toBe("suppressed_no_confirmation");
    const suppression = screen.getByTestId("day-desk-suppression");
    expect(suppression.textContent || "").toMatch(/intraday confirmation absent/i);
  });

  test("day_desk_renders_real_setups_when_market_open_and_intraday_setups_present", () => {
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={{
          ...baseScanner,
          setups: [
            {
              symbol: "DAYAAA",
              direction: "bullish",
              score: 0.78, // above DAY_DESK_ACTIVE_SCORE_FLOOR
              triggers: ["orb_breakout_long", "vwap_reclaim"],
              timestamp_iso: "2026-05-01T14:30:00Z"
            },
            {
              symbol: "DAYBBB",
              direction: "bullish",
              score: 0.66,
              triggers: ["momentum_followthrough"],
              timestamp_iso: "2026-05-01T14:31:00Z"
            }
          ]
        }}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    const day = screen.getByTestId("day-desk-panel");
    expect(day.getAttribute("data-day-desk-posture")).toBe("active");
    // The actual setup symbols render in the Day Desk's signal section.
    const signalsRegion = screen.getByTestId("day-desk-signals");
    expect(signalsRegion).toBeInTheDocument();
    expect(signalsRegion.textContent || "").toMatch(/DAYAAA/);
    expect(signalsRegion.textContent || "").toMatch(/DAYBBB/);
    // No suppression block appears when the desk is Active (mutually exclusive).
    expect(screen.queryByTestId("day-desk-suppression")).toBeNull();
  });

  test("day_desk_reenable_copy_uses_DAY_vocabulary_not_swing_vocabulary", () => {
    // The prompt's "MODE-AWARE EMPTY-STATE LANGUAGE" rule explicitly forbids
    // reusing swing language ("regime / sector alignment, structure
    // readiness") for day suppression. Day copy must talk about volume,
    // momentum, and session structure.
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
    const reenable = screen.getByTestId("day-desk-reenable");
    expect(reenable).toBeInTheDocument();
    const text = (reenable.textContent || "").toLowerCase();
    // Heading uses the EXACT phrase from the spec.
    expect(text).toContain("what would re-enable day setups");
    // Day-vocabulary tokens present (at least one in each bucket).
    const hasVolume = text.includes("volume");
    const hasMomentum = text.includes("momentum");
    const hasSessionOrIntraday = text.includes("session") || text.includes("orb") || text.includes("intraday");
    expect(hasVolume).toBe(true);
    expect(hasMomentum).toBe(true);
    expect(hasSessionOrIntraday).toBe(true);
    // The swing-specific phrase ("regime alignment incomplete") MUST NOT
    // appear inside the day re-enable block.
    expect(text).not.toContain("regime alignment");
    // The swing-specific phrase "sector confirmation" MUST NOT appear
    // inside the day re-enable block.
    expect(text).not.toContain("sector confirmation");
  });

  test("swing_desk_panel_has_swing_eyebrow_NOT_day_eyebrow", () => {
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
    const text = (swing.textContent || "").toLowerCase();
    expect(text).toContain("swing desk");
    expect(text).toContain("multi-day");
    // Swing card must NOT carry day-vocabulary "intraday (session-bound)".
    expect(text).not.toContain("intraday (session-bound)");
  });

  test("day_desk_footer_points_at_day_scanner_not_swing_scanner", () => {
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
    // The "View day scanner →" link must carry mode=day, never mode=swing —
    // a regression here would silently route users from the Day Desk into
    // the Swing scanner default.
    const link = screen.getByRole("link", { name: /view day scanner/i });
    expect(link).toHaveAttribute("href", "/dashboard/scanner?mode=day");
  });
});
