/**
 * Dashboard role-color language + Shared Context copy redesign — Mode Separation B28 Phase 2.
 *
 * Two intertwined design rules are locked in here:
 *
 * (A) ROLE COLOR ENCODES IDENTITY, NOT SIGNAL — every dashboard card carries a
 *     `data-card-role` attribute ("shared" | "swing" | "day") and renders a verbatim
 *     role pill ("SHARED CONTEXT" / "SWING · MULTI-DAY" / "DAY · INTRADAY"). A user
 *     glancing at the dashboard must be able to answer "is this swing, day, or shared
 *     context?" from hue + pill ALONE, without reading paragraph copy.
 *
 * (B) SHARED CONTEXT MUST READ AS OBSERVATION, NOT STRATEGY — the Short-Horizon
 *     Market State card (formerly "Weekly market context") replaces evaluative
 *     swing-coded language ("Constructive 5-session tape (background)") with strictly
 *     descriptive observational copy ("5-Session Outcome: Net upward price progress"),
 *     and renders the timeframe-binding clause + why-this-matters hint that prevent
 *     day traders from misreading shared context as swing intent.
 *
 * A regression that visually merges roles, drops the role pill on a card, or reintroduces
 * evaluative language on shared context is caught here.
 */

import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";

import { DashboardRedesign } from "@/components/dashboard-redesign";
import { ThemeProvider } from "@/lib/theme-provider";
import {
  SHORT_HORIZON_TIMEFRAME_LINE,
  SHORT_HORIZON_WHY_THIS_MATTERS
} from "@/components/weekly-market-context-widget";
import { roleAccents } from "@/lib/design-system";
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

function status(market: string): MarketStatusPayload {
  return { market, exchanges: {}, currencies: {} };
}

const baseMarket: MarketOverview = {
  snapshots: [],
  news: [],
  status: status("open")
};
const baseScanner: ScannerOverview = {
  gapIntelligence: [],
  setups: [],
  spyPct: 0.1,
  qqqPct: 0.1,
  regimeLabel: "Neutral"
};
const baseWeekly = [
  { symbol: "SPY", label: "Large cap", pct5d: 1.19, lastPrice: 500 },
  { symbol: "QQQ", label: "Tech / growth", pct5d: 2.25, lastPrice: 400 },
  { symbol: "IWM", label: "Small cap", pct5d: 2.16, lastPrice: 200 }
];

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

// ─────────────────────────────────────────────────────────────────────────────
// (A) ROLE COLOR LANGUAGE
// ─────────────────────────────────────────────────────────────────────────────

describe("dashboard role-color language (Mode Separation B28 Phase 2)", () => {
  test("swing_desk_panel_carries_role_swing_and_role_pill_SWING_MULTI_DAY", () => {
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
    expect(swing.getAttribute("data-card-role")).toBe("swing");
    const pill = swing.querySelector('[data-testid="dashboard-card-role-pill"]');
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute("data-card-role-pill")).toBe("swing");
    expect((pill?.textContent || "").trim().toUpperCase()).toContain("SWING · MULTI-DAY");
  });

  test("day_desk_panel_carries_role_day_and_role_pill_DAY_INTRADAY", () => {
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
    expect(day.getAttribute("data-card-role")).toBe("day");
    const pill = day.querySelector('[data-testid="dashboard-card-role-pill"]');
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute("data-card-role-pill")).toBe("day");
    expect((pill?.textContent || "").trim().toUpperCase()).toContain("DAY · INTRADAY");
  });

  test("short_horizon_card_carries_role_shared_and_role_pill_SHARED_CONTEXT", () => {
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
    const card = screen.getByTestId("shared-market-context-weekly");
    expect(card.getAttribute("data-card-role")).toBe("shared");
    const pill = card.querySelector('[data-testid="dashboard-card-role-pill"]');
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute("data-card-role-pill")).toBe("shared");
    expect((pill?.textContent || "").trim().toUpperCase()).toContain("SHARED CONTEXT");
  });

  test("market_pulse_and_sector_rotation_and_catalysts_and_validation_ledger_are_all_role_shared", () => {
    // Four cards on the dashboard right rail/below the desks are shared infrastructure
    // both desks read. They must all carry `data-card-role="shared"` so the user sees
    // a single visual family of slate-tinted cards for "this is environmental".
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
    for (const tid of [
      "shared-market-pulse-card",
      "shared-sector-rotation-card",
      "shared-upcoming-catalysts-card",
      "shared-signal-validation-ledger-card"
    ]) {
      const card = screen.getByTestId(tid);
      expect(card.getAttribute("data-card-role")).toBe("shared");
      const pill = card.querySelector('[data-testid="dashboard-card-role-pill"]');
      expect(pill).not.toBeNull();
      expect((pill?.textContent || "").trim().toUpperCase()).toContain("SHARED CONTEXT");
    }
  });

  test("role_accents_are_three_distinct_hue_families_not_aliased_to_each_other", () => {
    // The whole point of color-by-role is that hue distinguishes the three families
    // at a glance. If two roles ever shared an accent token (e.g. a regression that
    // typoed `swing` to point at the shared slate), the visual contract collapses.
    const dark = roleAccents.dark;
    const light = roleAccents.light;
    const darkAccents = [dark.shared.accent, dark.swing.accent, dark.day.accent];
    const lightAccents = [light.shared.accent, light.swing.accent, light.day.accent];
    expect(new Set(darkAccents).size).toBe(3);
    expect(new Set(lightAccents).size).toBe(3);
    // Pill labels are also distinct per role.
    const darkLabels = [dark.shared.pillLabel, dark.swing.pillLabel, dark.day.pillLabel];
    expect(new Set(darkLabels).size).toBe(3);
  });

  test("role_tinted_card_renders_a_left_edge_role_stripe", () => {
    // The left-edge stripe carries the strongest peripheral signal — even at a glance
    // the user should know which family a card belongs to without reading the pill.
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
    for (const tid of ["swing-desk-panel", "day-desk-panel", "shared-market-context-weekly"]) {
      const card = screen.getByTestId(tid);
      const stripe = card.querySelector('[data-testid="dashboard-card-role-stripe"]');
      expect(stripe).not.toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (B) SHARED CONTEXT COPY REDESIGN (Short-Horizon Market State)
// ─────────────────────────────────────────────────────────────────────────────

describe("Short-Horizon Market State copy redesign (Mode Separation B28 Phase 2)", () => {
  test("card_title_is_short_horizon_market_state_NOT_weekly_market_context", () => {
    // "Weekly" was strategy-coded toward swing and caused friction in the post-redesign
    // user audit. The new title is timeframe-anchored and explicitly cadence-neutral.
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
    const card = screen.getByTestId("shared-market-context-weekly");
    const title = card.querySelector("h3");
    expect(title).not.toBeNull();
    const titleText = (title?.textContent || "").toLowerCase();
    expect(titleText).toContain("short-horizon market state");
    expect(titleText).toContain("last ~5 sessions");
    // Old swing-coded title forbidden.
    expect(titleText).not.toContain("weekly market context");
  });

  test("status_line_is_observational_NOT_evaluative_constructive_or_setup_language", () => {
    // The headline status line must describe what the last ~5 daily closes DID
    // (net upward / net downward / mixed direction) — never an evaluative judgment
    // like "Constructive" / "Defensive" / "setup" / "continuation".
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
    const statusLine = screen.getByTestId("short-horizon-status-line");
    const text = (statusLine.textContent || "").toLowerCase();
    // Observational vocabulary present.
    expect(text).toContain("5-session outcome");
    // Specifically for the +1.19 / +2.25 / +2.16 baseWeekly above (avg ~1.87% > 0.6),
    // the status line is the upward variant — observational, not evaluative.
    expect(text).toContain("net upward price progress");
    // Banned evaluative / swing-coded words across all status-line variants.
    for (const banned of ["constructive", "defensive", "tape", "(background)", "setup", "continuation"]) {
      expect(text).not.toContain(banned);
    }
  });

  test("status_line_for_net_downward_average_uses_net_downward_language", () => {
    // Threshold-boundary lock-in: at avg ≤ -0.6%, the status line flips to net-downward
    // language, NOT "Defensive 5-session tape" (banned evaluative legacy wording).
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={baseScanner}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={[
          { symbol: "SPY", label: "Large cap", pct5d: -1.5, lastPrice: 500 },
          { symbol: "QQQ", label: "Tech / growth", pct5d: -1.8, lastPrice: 400 },
          { symbol: "IWM", label: "Small cap", pct5d: -2.4, lastPrice: 200 }
        ]}
        sectorRotation={[]}
      />
    );
    const statusLine = screen.getByTestId("short-horizon-status-line");
    const text = (statusLine.textContent || "").toLowerCase();
    expect(text).toContain("net downward price progress");
    expect(text).not.toContain("defensive");
    expect(text).not.toContain("tape");
  });

  test("status_line_for_mixed_average_uses_mixed_direction_language", () => {
    // Threshold-boundary lock-in: at -0.6% < avg < 0.6%, status line is the mixed variant.
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={baseScanner}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={[
          { symbol: "SPY", label: "Large cap", pct5d: 0.1, lastPrice: 500 },
          { symbol: "QQQ", label: "Tech / growth", pct5d: -0.2, lastPrice: 400 },
          { symbol: "IWM", label: "Small cap", pct5d: 0.3, lastPrice: 200 }
        ]}
        sectorRotation={[]}
      />
    );
    const statusLine = screen.getByTestId("short-horizon-status-line");
    const text = (statusLine.textContent || "").toLowerCase();
    expect(text).toContain("mixed direction");
    expect(text).not.toContain("tape");
  });

  test("timeframe_binding_clause_and_why_this_matters_hint_are_rendered_verbatim", () => {
    // The two guardrail strings do the heavy lifting that prevents day traders from
    // misreading shared context as swing intent. They are exported from the widget so
    // tests can pin the EXACT wording, and so a refactor cannot accidentally drop them.
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
    const guardrails = screen.getByTestId("short-horizon-guardrails");
    expect(guardrails.textContent || "").toContain(SHORT_HORIZON_TIMEFRAME_LINE);
    expect(guardrails.textContent || "").toContain(SHORT_HORIZON_WHY_THIS_MATTERS);
    // The timeframe clause explicitly disclaims trade-duration intent.
    expect(SHORT_HORIZON_TIMEFRAME_LINE.toLowerCase()).toContain("does not imply trade duration");
  });

  test("subtitle_explicitly_disclaims_trade_signal_status", () => {
    // Subtitle reads as "Daily-close price behavior across major indices. Shared
    // background input for all desks; not a trade signal." — the "not a trade signal"
    // clause is the explicit disclaimer that completes the role pill's promise.
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
    const card = screen.getByTestId("shared-market-context-weekly");
    const text = (card.textContent || "").toLowerCase();
    expect(text).toContain("not a trade signal");
    expect(text).toContain("shared background input for all desks");
  });
});
