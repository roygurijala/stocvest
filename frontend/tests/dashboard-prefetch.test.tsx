/**
 * Tier 1.A — Dashboard `<Link>` prefetch lock-in tests.
 *
 * See `docs/PERFORMANCE.md` §3 (invariants) + §4 (Tier 1.A shipped scope).
 *
 * The user observed the dashboard taking 16.78s on `/dashboard` with
 * 14.61s of that in "Content Download" on a single
 * `/dashboard/signals?symbol=AAPL&ref=dashboard-ribbon...` request.
 * The waveform — long content download, short server wait — is the
 * fingerprint of multiple RSC payloads being drained in parallel
 * over one connection. Root cause: heavy dashboard `<Link>` targets
 * omitted the `prefetch={false}` flag, so Next.js 14.2's default
 * `prefetch="auto"` behaviour speculatively SSR-rendered the
 * heaviest targets (`/dashboard/signals`, scanner routes) from many
 * visible anchors on mount.
 *
 * The fix is one attribute per Link. The risk is regression — a
 * future refactor could trivially drop the flag and re-introduce
 * the prefetch storm without anyone noticing until the dashboard
 * feels sluggish again. These tests pin the attribute presence so
 * a regression breaks CI loudly, with a comment pointing at this
 * doc.
 *
 * What we assert (command-center dashboard):
 *
 *   1. Discovery scanner link, watchlist radar, insight callout, and live
 *      status CTA carry `prefetch={false}`.
 *   2. Live status CTA carries `prefetch={false}`.
 *   3. Desk mode pills switch the Scanner card href between swing/day.
 *
 * What we deliberately do NOT assert:
 *
 *   * That the sidebar / top-bar nav links carry `prefetch={false}`.
 *     Those are 1-of-N targets (one Settings link, one Performance
 *     link, etc.), not N-of-N like repeated heavy CTAs. Next.js's default
 *     prefetch is fine for those.
 *
 *   * That clicking a link still navigates. `prefetch={false}` is
 *     a routing optimization flag — it doesn't affect click
 *     behaviour. Covered transitively by the existing
 *     `dashboard-scanner-mode-links.test.tsx` and
 *     `dashboard-redesign-phase-b-c.test.tsx` suites which verify
 *     `href` values.
 */

import "./mocks/dashboard-desk-refresh";

import type { ReactElement, AnchorHTMLAttributes } from "react";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";

vi.mock("@/lib/hooks/use-is-mobile-layout", () => ({
  useIsMobileLayout: () => false
}));

// Mock `next/link` so the `prefetch` prop is surfaced as a DOM
// data attribute. Next.js 14's real `<Link>` swallows the
// `prefetch` flag — it changes router behaviour but leaves no DOM
// trace, which makes it impossible to assert from a Vitest unit
// test. This mock preserves the exact rendering contract of a
// real `<Link>` (it's still an anchor with the same href + style +
// className + testIds) and forwards `prefetch` as
// `data-prefetch="false" | "true" | "auto"` so the assertions
// below can grep it deterministically. The mock is scoped to this
// file only.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    prefetch,
    children,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    prefetch?: boolean | null;
    children?: React.ReactNode;
  }) => {
    const dp =
      prefetch === false ? "false" : prefetch === true ? "true" : "auto";
    return (
      <a {...rest} data-prefetch={dp}>
        {children}
      </a>
    );
  }
}));

import { DashboardRedesign } from "@/components/dashboard-redesign";
import { ThemeProvider } from "@/lib/theme-provider";
import type { MarketOverview, MarketStatusPayload } from "@/lib/api/market";
import type { IntradaySetupPayload, ScannerOverview } from "@/lib/api/scanner";

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

/**
 * Hard assertion: the anchor must carry `data-prefetch="false"`.
 *
 * Via the `next/link` mock at the top of this file, the
 * `prefetch={false}` prop on every `<Link>` in source becomes a
 * `data-prefetch="false"` attribute on the rendered anchor. If a
 * future refactor drops the flag (so the `<Link>` falls back to
 * Next's default `prefetch="auto"`), the mock writes
 * `data-prefetch="auto"` and this assertion fails loud — with a
 * clear pointer at the doc that explains why the flag matters.
 */
function assertLinkHasPrefetchDisabled(
  anchor: HTMLAnchorElement | null,
  label: string
) {
  expect(anchor, `${label} anchor must exist`).not.toBeNull();
  const dp = anchor!.getAttribute("data-prefetch");
  expect(
    dp,
    `${label} MUST carry prefetch={false} — see docs/PERFORMANCE.md §3.1 and §4. ` +
      `Got data-prefetch="${dp}". Adding back the speculative prefetch ` +
      `re-introduces the dashboard's 16s "Content Download" regression.`
  ).toBe("false");
}

function anchorByHref(root: HTMLElement, href: string): HTMLAnchorElement | null {
  return root.querySelector(`a[href="${href}"]`) as HTMLAnchorElement | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// (1) Opportunities overview + live status
// ─────────────────────────────────────────────────────────────────────────────

describe("Opportunities overview (Tier 1.A prefetch invariant)", () => {
  test("scanner_watchlist_and_signals_cards_carry_prefetch_false", () => {
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
    const discovery = screen.getByTestId("dashboard-discovery-feed");
    assertLinkHasPrefetchDisabled(
      anchorByHref(discovery, "/dashboard/scanner?mode=day"),
      "discovery Open Scanner (default day desk)"
    );
    assertLinkHasPrefetchDisabled(
      anchorByHref(screen.getByTestId("dashboard-watchlist-radar"), "/dashboard/watchlists?desk=day"),
      "watchlist radar link"
    );
    assertLinkHasPrefetchDisabled(
      anchorByHref(screen.getByTestId("dashboard-insight"), "/dashboard/scanner?mode=day"),
      "insight Monitor Scanner"
    );
    const live = screen.getByTestId("dashboard-live-status");
    const liveCta = live.querySelector("a[href^='/dashboard/scanner']") as HTMLAnchorElement | null;
    assertLinkHasPrefetchDisabled(liveCta, "live status scanner CTA");
  });

  test("scanner_card_href_follows_desk_mode_pill", () => {
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
    const discovery = screen.getByTestId("dashboard-discovery-feed");
    fireEvent.click(screen.getByTestId("dashboard-desk-mode-swing"));
    assertLinkHasPrefetchDisabled(
      anchorByHref(discovery, "/dashboard/scanner?mode=swing"),
      "discovery Open Scanner (swing desk)"
    );
    fireEvent.click(screen.getByTestId("dashboard-desk-mode-day"));
    assertLinkHasPrefetchDisabled(
      anchorByHref(discovery, "/dashboard/scanner?mode=day"),
      "discovery Open Scanner (day desk)"
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (2) Heavy navigations still disabled when setups exist (regression guard)
// ─────────────────────────────────────────────────────────────────────────────

describe("Dashboard heavy links (Tier 1.A prefetch invariant, with setups)", () => {
  test("opportunities_still_disable_prefetch_when_scanner_has_setups", () => {
    const swingSetup: IntradaySetupPayload = {
      symbol: "SWGPF1",
      direction: "bullish",
      score: 0.86,
      triggers: ["ema_cross"],
      timestamp_iso: "2026-05-01T13:00:00Z",
      scanner_mode: "swing_daily"
    };
    const daySetup: IntradaySetupPayload = {
      symbol: "DAYPF1",
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
    const discovery = screen.getByTestId("dashboard-discovery-feed");
    assertLinkHasPrefetchDisabled(
      anchorByHref(discovery, "/dashboard/scanner?mode=day"),
      "discovery Open Scanner"
    );
    assertLinkHasPrefetchDisabled(
      anchorByHref(screen.getByTestId("dashboard-insight"), "/dashboard/scanner?mode=day"),
      "insight Monitor Scanner"
    );
  });
});
