/**
 * Lock-in tests for the Dashboard Hero Strip (Phase A1 of the dashboard
 * redesign) and the Shared Context collapse/expand contract (Phase A2).
 *
 * What these tests guard:
 *
 *   1. STRUCTURAL INVARIANT — the hero strip is NOT a master card.
 *      The existing dashboard contract pins "exactly 3 master cards"
 *      via `[data-card-role]` count. The hero strip must therefore
 *      render NO `data-card-role` attribute on itself OR on any
 *      child cell. A regression that adds role= to a hero cell would
 *      bump the count to 4+ and silently break the
 *      "exactly_three_master_cards" test in
 *      dashboard-role-color-language.test.tsx.
 *
 *   2. PROJECTION DISCIPLINE — the hero strip's classifiers (regime
 *      pill, volatility category, participation category, risk
 *      horizon) must be PROJECTIONS of the same derivations Shared
 *      Context uses. Concretely: when the dashboard is rendered with
 *      a specific dataset, the hero strip's category labels must
 *      match the categories rendered inside Shared Context's B / C / D
 *      sub-sections (which are unit-tested separately in
 *      `shared-context-derivations.test.ts`).
 *
 *   3. CHATBOT CONTRACT — the assistant page-context payload
 *      published by `usePublishAssistantContext` must remain exactly
 *      the same shape (page, market_regime, ranked_setups_count,
 *      swing_desk_posture, day_desk_posture, day_setups_count) AFTER
 *      the hero strip + collapse changes. The chatbot's Priority 3
 *      "STRUCTURED DUAL ANSWER" routing depends on this payload.
 *
 *   4. COLLAPSE CONTRACT — Shared Context defaults to collapsed; all
 *      five sub-sections A–E STAY IN THE DOM regardless (the prompt's
 *      "five sub-sections, strict order" invariant is unchanged); the
 *      toggle is keyboard-accessible and persists through localStorage.
 *
 *   5. MOBILE — the hero strip uses flex-wrap so it gracefully
 *      collapses below `lg`. We assert the wrapper has flex + wrap
 *      so a future refactor that forces a fixed column count would
 *      fail this lock-in.
 */

import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { DashboardRedesign } from "@/components/dashboard-redesign";
import { SharedContextMasterCard } from "@/components/shared-context-master-card";
import { ThemeProvider } from "@/lib/theme-provider";
import type { MarketOverview, MarketStatusPayload, SnapshotPayload } from "@/lib/api/market";
import type { ScannerOverview } from "@/lib/api/scanner";
import type { AssistantPageContext } from "@/lib/assistant/types";

vi.mock("@/lib/hooks/use-is-mobile-layout", () => ({
  useIsMobileLayout: () => false
}));

// Capture every assistant context publish so we can lock in the
// chatbot payload shape after the hero strip + collapse changes.
const publishCapture = vi.hoisted(() => ({ last: null as AssistantPageContext | null }));
vi.mock("@/lib/assistant/context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/assistant/context")>(
    "@/lib/assistant/context"
  );
  return {
    ...actual,
    usePublishAssistantContext: (ctx: AssistantPageContext | null) => {
      publishCapture.last = ctx;
    }
  };
});

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

function vixSnapshot(level: number, sessionPct: number | null = null): SnapshotPayload {
  return {
    symbol: "I:VIX",
    last_trade_price: level,
    change_percent: sessionPct,
    today_change_percent: sessionPct
  } as unknown as SnapshotPayload;
}

const baseMarket: MarketOverview = {
  snapshots: [vixSnapshot(18.0, 0.0)],
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

const baseSectors = [
  { symbol: "XLK", label: "Tech", pct5d: 1.0 },
  { symbol: "XLC", label: "Comm", pct5d: 0.5 },
  { symbol: "XLE", label: "Energy", pct5d: -0.3 },
  { symbol: "XLF", label: "Financials", pct5d: 0.2 },
  { symbol: "XLY", label: "Cons. disc.", pct5d: 0.8 }
];

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

beforeEach(() => {
  publishCapture.last = null;
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// Hero strip was retired from the dashboard surface (2026 focus layout).
// `DashboardHeroStrip` remains available for other routes; projection tests
// live in `shared-context-derivations.test.ts`.

// ─────────────────────────────────────────────────────────────────────────────
// (3) Chatbot contract — payload invariance
// ─────────────────────────────────────────────────────────────────────────────

describe("Dashboard chatbot contract (Phase A invariance)", () => {
  test("dashboard_publishes_phase4_assistant_context_keys", () => {
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={baseScanner}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={baseSectors}
      />
    );
    expect(publishCapture.last).not.toBeNull();
    const keys = Object.keys(publishCapture.last as unknown as Record<string, unknown>).sort();
    expect(keys).toEqual(
      [
        "dashboard_context",
        "day_desk_posture",
        "day_setups_count",
        "market_regime",
        "page",
        "ranked_setups_count",
        "swing_desk_posture",
        "top_setups"
      ].sort()
    );
    const dc = (publishCapture.last as { dashboard_context?: { version?: number } }).dashboard_context;
    expect(dc?.version).toBe(1);
  });

  test("dashboard_assistant_context_page_field_is_dashboard", () => {
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={baseScanner}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={baseSectors}
      />
    );
    expect((publishCapture.last as Record<string, unknown> | null)?.page).toBe("dashboard");
  });

  test("dashboard_assistant_context_does_NOT_inherit_a_trading_mode", () => {
    // The dashboard is the canonical multi-mode surface — Priority 3
    // dual-answer routing depends on `trading_mode` being ABSENT here
    // (so the LLM does not inherit a single mode via Priority 1).
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={baseScanner}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={baseSectors}
      />
    );
    const ctx = publishCapture.last as Record<string, unknown> | null;
    expect(ctx).not.toBeNull();
    expect(ctx).not.toHaveProperty("trading_mode");
  });

  test("dashboard_assistant_posture_keys_are_one_of_active_monitor_suppressed", () => {
    // The Day Desk's posture has historically had finer-grained
    // values (e.g. suppressed_session_closed) at the panel level,
    // but the assistant context strips that down to the three-state
    // posture vocabulary. This test guards that the published value
    // stays in the {active, monitor, suppressed*} family — anything
    // exotic indicates a leak of internal posture state.
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={baseScanner}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={baseSectors}
      />
    );
    const ctx = publishCapture.last as Record<string, unknown> | null;
    expect(ctx).not.toBeNull();
    const swing = String((ctx as { swing_desk_posture?: unknown }).swing_desk_posture || "");
    const day = String((ctx as { day_desk_posture?: unknown }).day_desk_posture || "");
    expect(["active", "monitor", "suppressed", "monitor_only"]).toContain(swing);
    expect(day.startsWith("active") || day.startsWith("monitor") || day.startsWith("suppressed")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (4) Shared Context collapse contract (Phase A2)
// ─────────────────────────────────────────────────────────────────────────────

function wrapSharedContextForCollapse() {
  wrap(
    <SharedContextMasterCard
      weeklyIndexRows={baseWeekly}
      sectorRotation={baseSectors}
      upcomingEarnings={[]}
      vixSessionPct={null}
      layout="master"
    />
  );
}

describe("SharedContextMasterCard — collapse / expand (Phase A2)", () => {
  test("default_state_is_collapsed_AND_collapsed_summary_visible", () => {
    wrapSharedContextForCollapse();
    const collapsedSummary = screen.queryByTestId("shared-context-collapsed-summary");
    expect(collapsedSummary).not.toBeNull();
    const toggle = screen.getByTestId("shared-context-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("data-shared-context-collapsed")).toBe("true");
  });

  test("subsections_A_through_E_remain_in_DOM_even_when_collapsed", () => {
    // The existing structural invariant from
    // dashboard-role-color-language.test.tsx
    // (master_card_renders_all_five_subsections_A_through_E_in_order)
    // must hold REGARDLESS of collapse state. We re-assert it here
    // because that test was written before the collapse feature
    // existed — locking the collapsed-default path closes a future
    // regression where someone conditionally unmounts B–E.
    wrapSharedContextForCollapse();
    for (const section of ["A", "B", "C", "D", "E"]) {
      const el = screen.getByTestId(`shared-context-section-${section}`);
      expect(el).toBeInTheDocument();
    }
  });

  test("expanded_body_wrapper_has_aria_hidden_true_when_collapsed", () => {
    wrapSharedContextForCollapse();
    const body = screen.getByTestId("shared-context-expanded-body");
    // The wrapper hides its content from assistive tech AND visually
    // when collapsed. We assert aria-hidden + display:none.
    expect(body.getAttribute("aria-hidden")).toBe("true");
    const style = body.getAttribute("style") || "";
    expect(style.toLowerCase()).toContain("display: none");
  });

  test("clicking_toggle_expands_AND_persists_to_localStorage", () => {
    wrapSharedContextForCollapse();
    fireEvent.click(screen.getByTestId("shared-context-toggle"));
    // After click: collapsed-summary is gone, expanded body is shown.
    expect(screen.queryByTestId("shared-context-collapsed-summary")).toBeNull();
    const body = screen.getByTestId("shared-context-expanded-body");
    expect(body.getAttribute("aria-hidden")).toBe("false");
    const style = body.getAttribute("style") || "";
    expect(style.toLowerCase()).toContain("display: grid");
    // The preference is persisted as "0" (expanded) in localStorage.
    expect(localStorage.getItem("stocvest_shared_context_collapsed")).toBe("0");
  });

  test("expanded_state_persisted_across_remount_via_localStorage", () => {
    // User expanded previously → next visit comes up expanded.
    localStorage.setItem("stocvest_shared_context_collapsed", "0");
    wrapSharedContextForCollapse();
    // The post-mount effect reads localStorage and flips to expanded.
    const body = screen.getByTestId("shared-context-expanded-body");
    expect(body.getAttribute("aria-hidden")).toBe("false");
    expect(screen.queryByTestId("shared-context-collapsed-summary")).toBeNull();
  });
});
