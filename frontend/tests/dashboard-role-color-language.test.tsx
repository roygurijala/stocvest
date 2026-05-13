/**
 * Dashboard role-color language + Shared Context master card.
 *
 * Three intertwined design contracts are locked in here:
 *
 * (A) ROLE IDENTITY IS LABELLED, NOT LOUD — every dashboard MASTER card
 *     carries a `data-card-role` attribute ("shared" | "swing" | "day") and
 *     renders a verbatim role pill ("SHARED CONTEXT" / "SWING · MULTI-DAY" /
 *     "DAY · INTRADAY"). Role hue surfaces as a 4px-wide left-edge accent on
 *     the canonical {@link cardSurfaceStyle} shell so every dashboard card
 *     shares the same visual contract as the rest of the application
 *     (Signals page, Scanner page, Performance page, Evidence sub-panels).
 *     The previous Phase 2b "bright 2px rail + 4px top rail + 3px left
 *     stripe + 9% gradient" treatment was retired when the user asked for
 *     uniform look-and-feel across the application.
 *
 * (B) ONE SHARED CONTEXT MASTER CARD with five strictly-ordered sub-sections
 *     (A-E). Phase 2b replaced the previous four separate shared cards
 *     (Short-Horizon Market State / Market Pulse / Sector Rotation / Upcoming
 *     Catalysts) with one consolidated surface. Per the user directive:
 *     "Nothing else at the same hierarchy level. No shared context scattered
 *     elsewhere. This creates a mental model users can learn once."
 *
 * (C) STRICT OBSERVATIONAL LANGUAGE — no sub-section content uses evaluative
 *     or strategy-coded vocabulary ("setup", "continuation", "trend intact",
 *     "constructive"). The Environment Summary (Section E) describes what
 *     the environment IS, not what to do about it.
 *
 * A regression that visually merges roles, scatters shared context across
 * multiple cards, or reintroduces evaluative language is caught here.
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
  // Phase 2b: rows include `closes5d` so Section A renders sparklines. We use
  // tight values so the sparkline path is meaningful but the % bucket lands
  // in the "Net upward" zone (avg pct5d > 0.6% → "drift up").
  { symbol: "SPY", label: "Large cap", pct5d: 1.19, lastPrice: 500, closes5d: [495, 497, 498, 499, 500] },
  { symbol: "QQQ", label: "Tech / growth", pct5d: 2.25, lastPrice: 400, closes5d: [391, 393, 395, 398, 400] },
  { symbol: "IWM", label: "Small cap", pct5d: 2.16, lastPrice: 200, closes5d: [195, 196, 198, 199, 200] }
];

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

// ─────────────────────────────────────────────────────────────────────────────
// (A) ROLE IDENTITY — three master cards, labelled role pill + 4px borderLeft
// ─────────────────────────────────────────────────────────────────────────────

describe("dashboard role-color language (Mode Separation B28 Phase 2b)", () => {
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

  test("shared_context_master_card_carries_role_shared_and_role_pill_SHARED_CONTEXT", () => {
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
    const card = screen.getByTestId("shared-context-master-card");
    expect(card.getAttribute("data-card-role")).toBe("shared");
    const pill = card.querySelector('[data-testid="dashboard-card-role-pill"]');
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute("data-card-role-pill")).toBe("shared");
    expect((pill?.textContent || "").trim().toUpperCase()).toContain("SHARED CONTEXT");
  });

  test("dashboard_has_exactly_three_master_cards_at_top_hierarchy_level", () => {
    // Phase 2b "nothing else at the same hierarchy level" invariant — the
    // dashboard renders EXACTLY three role-tinted master cards: one shared,
    // one swing, one day. Any future card that needs role color must justify
    // its presence at the same structural weight; the default is to either
    // fold into Shared Context (if it's environmental) or go to a tertiary
    // surface (if it's neither environmental nor decision-engine).
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
    const roleCards = document.querySelectorAll("[data-card-role]");
    const masterRoles = Array.from(roleCards)
      .map((el) => el.getAttribute("data-card-role"))
      .filter((r): r is string => typeof r === "string" && r.length > 0);
    expect(masterRoles).toHaveLength(3);
    expect(new Set(masterRoles)).toEqual(new Set(["shared", "swing", "day"]));
  });

  test("role_accents_each_define_a_distinct_surface_accent_for_the_borderLeft_marker", () => {
    // The surface `accent` is what the {@link DashboardCard} 4px borderLeft
    // marker uses to encode role identity. Each role must claim a distinct
    // hue so the marker is unambiguous.
    const dark = roleAccents.dark;
    const light = roleAccents.light;
    for (const theme of [dark, light]) {
      const accents = [theme.shared.accent, theme.swing.accent, theme.day.accent];
      expect(new Set(accents).size).toBe(3);
    }
  });

  test("every_master_card_renders_a_role_pill_AND_NOT_the_legacy_loud_rail_treatment", () => {
    // Locks the "uniform look-and-feel" decision: every role-tinted master
    // card carries a labelled role pill (matches the small-pill pattern used
    // for NOT INVESTMENT ADVICE on the Evidence card) and must NOT reintroduce
    // the retired Phase 2b loud rail treatment (4px top rail strip + 3px
    // left stripe). A regression that brings back either dead element makes
    // dashboard cards visually inconsistent with the rest of the app.
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
    for (const tid of ["swing-desk-panel", "day-desk-panel", "shared-context-master-card"]) {
      const card = screen.getByTestId(tid);
      const pill = card.querySelector('[data-testid="dashboard-card-role-pill"]');
      const stripe = card.querySelector('[data-testid="dashboard-card-role-stripe"]');
      const topRail = card.querySelector('[data-testid="dashboard-card-role-top-rail"]');
      expect(pill).not.toBeNull();
      expect(stripe).toBeNull();
      expect(topRail).toBeNull();
    }
  });

  test("every_master_card_uses_borderRadius_xl_and_a_4px_role_tinted_borderLeft", () => {
    // Canonical dashboard card shell: borderRadius.xl (16px, matches Signals
    // / Scanner / Performance cards) + a 4px borderLeft in the role's
    // surface accent. The borderLeft is the single channel that anchors role
    // identity visually; the rest of the shell is identical to every other
    // card in the app.
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
    for (const tid of ["swing-desk-panel", "day-desk-panel", "shared-context-master-card"]) {
      const card = screen.getByTestId(tid);
      const style = card.getAttribute("style") || "";
      expect(style.toLowerCase()).toContain("border-radius: 1rem");
      // 4px borderLeft is the role marker — assert it explicitly so a future
      // flatten can't quietly strip role identity off the card.
      expect(style.toLowerCase()).toMatch(/border-left:\s*4px\s+solid/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (B) SHARED CONTEXT MASTER CARD — sub-sections A through E
// ─────────────────────────────────────────────────────────────────────────────

describe("Shared Context master card structure (Mode Separation B28 Phase 2b)", () => {
  test("master_card_renders_all_five_subsections_A_through_E_in_order", () => {
    // The five sub-sections are NON-NEGOTIABLE per the user directive. Order
    // matters: A (price state) → B (volatility) → C (participation) → D (risk)
    // → E (summary). DOM order is checked because the summary in E reads as
    // the synthesis of everything above; flipping ordering breaks reading flow.
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
    const a = screen.getByTestId("shared-context-section-A");
    const b = screen.getByTestId("shared-context-section-B");
    const c = screen.getByTestId("shared-context-section-C");
    const d = screen.getByTestId("shared-context-section-D");
    const e = screen.getByTestId("shared-context-section-E");
    expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(b.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(c.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(d.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("section_A_renders_three_index_tiles_each_with_a_daily_returns_histogram", () => {
    // Section A revision (2026-05-13): the 5-day line sparkline was replaced
    // by a 5-bar signed daily-returns histogram. Rationale: at this card
    // size (~120px) a line conveys little beyond the % label already shown
    // beneath it, while signed bars expose intra-week shape ("steady grind"
    // vs "choppy reversal" vs "one-day spike"). Lock-ins for the bar viz
    // live in frontend/tests/index-returns-histogram.test.tsx; this test
    // pins the *integration* — each tile in Section A must mount the
    // histogram and the % label, with no axes/labels inside the SVG.
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
    for (const sym of ["SPY", "QQQ", "IWM"]) {
      const tile = screen.getByTestId(`shared-context-index-tile-${sym}`);
      expect(tile).toBeInTheDocument();
      const histogram = tile.querySelector('[data-testid="index-returns-histogram"]');
      expect(histogram).not.toBeNull();
      // Anti-regression — the old line sparkline must not co-exist on the tile.
      expect(tile.querySelector('[data-testid="index-sparkline"]')).toBeNull();
      // The histogram is an SVG — no axes/labels: bars are <rect> children,
      // no <text> nodes appear inside the chart canvas. (A <title> child per
      // <rect> is allowed — it's read by screen readers, not rendered.)
      expect(histogram?.querySelector("polyline")).toBeNull();
      expect((histogram?.querySelectorAll("rect").length ?? 0)).toBeGreaterThan(0);
      const visibleTextNodes = Array.from(histogram?.querySelectorAll("text") ?? []);
      expect(visibleTextNodes).toHaveLength(0);
      // The 5d % number still renders alongside the histogram.
      expect((tile.textContent || "").toLowerCase()).toContain(`${sym.toLowerCase()}`);
      expect((tile.textContent || "")).toMatch(/[+\-]?\d+\.\d{2}%/);
    }
  });

  test("section_B_renders_a_volatility_CATEGORY_only_NOT_an_ATR_number", () => {
    // Per the user directive: "Volatility: Contained · Daily ranges stable
    // vs prior week (Category only — no ATR numbers)".
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
    const b = screen.getByTestId("shared-context-section-B");
    const cat = b.querySelector('[data-testid="shared-context-volatility-category"]');
    expect(cat).not.toBeNull();
    const catText = (cat?.textContent || "").toLowerCase();
    expect(catText).toContain("volatility:");
    expect(catText).toMatch(/contained|expanding|compressed|unknown/);
    // Anti-leakage: ATR numbers must NOT surface in Section B per the directive.
    expect((b.textContent || "").toLowerCase()).not.toContain("atr");
  });

  test("section_C_renders_a_participation_CATEGORY_plus_the_sector_chip_row", () => {
    // Per the user directive: "Participation: Broad · Large- and small-cap
    // indices participating". The sector chip row stays as supporting detail
    // (it was a top-level card; now it lives inside Section C as evidence
    // for the category label).
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={baseScanner}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[
          { symbol: "XLK", label: "Tech", pct5d: 1.5 },
          { symbol: "XLC", label: "Comm", pct5d: 0.8 },
          { symbol: "XLE", label: "Energy", pct5d: -0.6 },
          { symbol: "XLF", label: "Financials", pct5d: 0.4 },
          { symbol: "XLY", label: "Cons. disc.", pct5d: 1.1 }
        ]}
      />
    );
    // Phase 2c: Section C now reports BEHAVIOR only.
    // Two categorical readouts — Rotation profile + Participation — and NO
    // ranked sector chip row. The chip row was a relative-strength ranking
    // (XLK +1.5%, XLE -0.6%, …), which the user's directive explicitly
    // banned from shared context (those belong DOWNSTREAM inside the Swing
    // Desk, not in environmental context).
    const c = screen.getByTestId("shared-context-section-C");
    const participation = c.querySelector('[data-testid="shared-context-participation-category"]');
    expect(participation).not.toBeNull();
    expect((participation?.textContent || "").toLowerCase()).toContain("participation:");
    const rotation = c.querySelector('[data-testid="shared-context-rotation-profile-category"]');
    expect(rotation).not.toBeNull();
    expect((rotation?.textContent || "").toLowerCase()).toContain("rotation profile:");
    // Lock-in: the % chip row MUST be gone. Anyone trying to add a ranked
    // per-sector strip back into shared context will fail this test.
    expect(c.querySelector('[data-testid="shared-context-sector-chip-row"]')).toBeNull();
    // And no sector ETF NAMES leak through Section C — naming sectors implies
    // leadership/allocation, which the user's directive bans.
    const cText = c.textContent || "";
    for (const sectorName of ["XLK", "XLC", "XLE", "XLF", "XLY", "XLI", "XLV", "XLP", "XLU", "XLB", "XLRE"]) {
      expect(cText).not.toContain(sectorName);
    }
  });

  test("section_C_title_uses_neutral_behavioral_language_NOT_breadth_tone", () => {
    // Phase 2c: per user directive, Section C is renamed from "Participation /
    // Breadth Tone" to "Sector Participation (Last ~5 Sessions)". The new
    // label anchors the time-horizon and reads as descriptive, not evaluative.
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
    const c = screen.getByTestId("shared-context-section-C");
    const text = c.textContent || "";
    expect(text).toContain("Sector Participation (Last ~5 Sessions)");
  });

  test("section_C_rotation_profile_label_is_one_of_the_closed_set", () => {
    // Lock-in: only Concentrated / Rotational / Mixed / Unknown — never
    // "Trending", "Leading", "Bullish", "Bearish", etc. Those would imply
    // direction or actionability, which the directive bans.
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={baseScanner}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[
          { symbol: "XLK", label: "Tech", pct5d: 1.2 },
          { symbol: "XLC", label: "Comm", pct5d: -0.5 },
          { symbol: "XLE", label: "Energy", pct5d: 1.8 },
          { symbol: "XLF", label: "Financials", pct5d: 0.4 },
          { symbol: "XLY", label: "Cons. disc.", pct5d: -1.0 }
        ]}
      />
    );
    const rotation = screen.getByTestId("shared-context-rotation-profile-category");
    const text = (rotation.textContent || "").toLowerCase();
    expect(text).toMatch(/concentrated|rotational|mixed|unknown/);
    for (const banned of [
      "trending",
      "leading",
      "leadership emerging",
      "bullish",
      "bearish",
      "strong sector",
      "weak sector",
      "winners",
      "losers"
    ]) {
      expect(text).not.toContain(banned);
    }
  });

  test("section_D_renders_a_risk_horizon_category_plus_earnings_list", () => {
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={baseScanner}
        earningsEvents={[
          { symbol: "AAPL", company_name: "Apple", report_date: "2026-05-15", report_time: "after_market" },
          { symbol: "MSFT", company_name: "Microsoft", report_date: "2026-05-16", report_time: "before_market" }
        ]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    const d = screen.getByTestId("shared-context-section-D");
    const cat = d.querySelector('[data-testid="shared-context-risk-category"]');
    expect(cat).not.toBeNull();
    const catText = (cat?.textContent || "").toLowerCase();
    expect(catText).toContain("risk horizon:");
    expect(catText).toMatch(/quiet|active|elevated/);
    const list = d.querySelector('[data-testid="shared-context-earnings-list"]');
    expect(list).not.toBeNull();
    expect((list?.textContent || "")).toContain("AAPL");
    expect((list?.textContent || "")).toContain("MSFT");
  });

  test("section_E_renders_an_environment_summary_sentence_plus_guardrails", () => {
    // Section E is the anchor line — single human-readable sentence that
    // joins A + B + C + D. Plus the timeframe-binding clause + why-this-matters
    // hint that prevent day traders from misreading shared context as swing
    // intent.
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
    const e = screen.getByTestId("shared-context-section-E");
    const summary = e.querySelector('[data-testid="shared-context-environment-summary"]');
    expect(summary).not.toBeNull();
    const summaryText = (summary?.textContent || "").toLowerCase();
    // Anchored vocabulary: every summary mentions price drift + volatility +
    // participation + macro risk in one sentence. For the upward-bias baseline
    // weekly rows, drift is "up".
    expect(summaryText).toContain("short-horizon price drift");
    expect(summaryText).toContain("volatility");
    expect(summaryText).toContain("participation");
    // Guardrails — both rendered verbatim under the summary.
    const guardrails = e.querySelector('[data-testid="shared-context-guardrails"]');
    expect(guardrails).not.toBeNull();
    expect(guardrails?.textContent || "").toContain(SHORT_HORIZON_TIMEFRAME_LINE);
    expect(guardrails?.textContent || "").toContain(SHORT_HORIZON_WHY_THIS_MATTERS);
  });

  test("master_card_is_strategy_agnostic_NO_setup_continuation_constructive_words", () => {
    // The MASTER CARD as a whole must NOT carry strategy-coded language on
    // any sub-section. Words below are the canonical "leak terms" that flag
    // a regression toward swing doctrine in shared infrastructure.
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={baseScanner}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[
          { symbol: "XLK", label: "Tech", pct5d: 1.5 },
          { symbol: "XLC", label: "Comm", pct5d: 0.8 },
          { symbol: "XLE", label: "Energy", pct5d: -0.6 },
          { symbol: "XLF", label: "Financials", pct5d: 0.4 },
          { symbol: "XLY", label: "Cons. disc.", pct5d: 1.1 }
        ]}
      />
    );
    const card = screen.getByTestId("shared-context-master-card");
    const text = (card.textContent || "").toLowerCase();
    for (const banned of [
      "constructive",
      "defensive 5-session tape",
      "tape (background)",
      "setup",
      "continuation",
      "trend intact"
    ]) {
      expect(text).not.toContain(banned);
    }
  });

  test("master_card_subtitle_explicitly_disclaims_trade_signal_status", () => {
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
    const card = screen.getByTestId("shared-context-master-card");
    const text = (card.textContent || "").toLowerCase();
    expect(text).toContain("not a trade signal");
    expect(text).toContain("market environment and constraints used by all desks");
  });

  test("dashboard_does_NOT_render_signal_validation_ledger_anymore", () => {
    // Phase 2c: per the user's directive — "a data element belongs in Shared
    // Context if and only if it answers what kind of market environment are
    // all traders operating in right now" — tracked outcomes are NOT shared
    // context. They were moved to the Performance page. The dashboard must
    // never render the validation ledger surface again.
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
    expect(screen.queryByTestId("signal-validation-ledger-tertiary")).toBeNull();
    // The dashboard root MUST NOT carry any link to the validation ledger
    // either — pulling tracked outcomes back into the market-context surface
    // (in any form, even as a link card) would re-create the mixing the user
    // explicitly called out.
    const dashboard = document.querySelector(".stocvest-dashboard-v2");
    expect(dashboard).not.toBeNull();
    const anchors = dashboard
      ? Array.from(dashboard.querySelectorAll('a[href="/dashboard/signal-validation"]'))
      : [];
    expect(anchors).toHaveLength(0);
  });

  test("section_A_index_tiles_have_direction_aware_borders_green_red_neutral", () => {
    // Phase 2c: SPY/QQQ/IWM tiles in Section A must have green/red highlighted
    // borders — green when 5-day net % is up, red when down, neutral when
    // flat or unknown. Each tile carries a `data-tile-direction` attribute
    // we lock against.
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={baseScanner}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={[
          { symbol: "SPY", label: "S&P 500", pct5d: 1.19, lastPrice: 500, closes5d: [495, 496, 498, 499, 500] },
          { symbol: "QQQ", label: "Nasdaq 100", pct5d: -2.0, lastPrice: 400, closes5d: [410, 408, 405, 402, 400] },
          { symbol: "IWM", label: "Russell 2000", pct5d: 0.05, lastPrice: 200, closes5d: [200, 200.1, 200, 199.9, 200] }
        ]}
        sectorRotation={[]}
      />
    );
    const spy = screen.getByTestId("shared-context-index-tile-SPY");
    expect(spy.getAttribute("data-tile-direction")).toBe("up");
    const qqq = screen.getByTestId("shared-context-index-tile-QQQ");
    expect(qqq.getAttribute("data-tile-direction")).toBe("down");
    const iwm = screen.getByTestId("shared-context-index-tile-IWM");
    expect(iwm.getAttribute("data-tile-direction")).toBe("flat");
  });

  test("subsections_B_C_D_E_each_render_as_their_own_bordered_subcard", () => {
    // Phase 2c: per user directive, sections B/C/D/E should each be CARDS
    // with highlighted borders, not paragraphs sharing one wall of text. We
    // lock against the `data-subsection-card` attribute the SubsectionCard
    // wrapper stamps on the DOM.
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
    for (const letter of ["B", "C", "D", "E"] as const) {
      const section = screen.getByTestId(`shared-context-section-${letter}`);
      expect(section.getAttribute("data-subsection-card")).toBe(letter);
    }
    // Section A is intentionally NOT a sub-card — it already IS a row of
    // three direction-bordered tiles. Wrapping it would create card-in-card
    // nesting that defeats the at-a-glance scan.
    const a = screen.getByTestId("shared-context-section-A");
    expect(a.getAttribute("data-subsection-card")).toBeNull();
  });

  test("swing_desk_primary_read_card_renders_on_the_canonical_card_shell", () => {
    // The Swing Desk "Primary read" card is the swing desk's dominant
    // decision surface when no setups are firing. Its visual contract must
    // match the canonical {@link cardSurfaceStyle} shell (same surface as
    // every other card in the app); role identity is anchored by the parent
    // Swing Desk panel's borderLeft + pill, so the child card itself does
    // not repeat the role hue. Phase 2c's 1.5px violet border + 6% gradient
    // was retired when the user asked for uniform look-and-feel across the
    // application; a regression that reintroduces a >1px coloured border
    // here makes the dashboard visually inconsistent with the rest of the
    // app and is caught by this lock-in.
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
    const card = screen.queryByTestId("swing-desk-primary-read-card");
    expect(card).not.toBeNull();
    const style = (card?.getAttribute("style") || "").toLowerCase();
    expect(style).not.toMatch(/border:\s*1\.5px/);
    expect(style).not.toMatch(/border:\s*2px/);
    expect(style).not.toContain("borderaccent");
  });
});
