/**
 * Tier 1 → Layer 4 — Dashboard hover-prefetch lock-in tests.
 *
 * See `docs/PERFORMANCE.md` §1 layer 4 + §4C.
 *
 * Companion to `dashboard-prefetch.test.tsx` (which asserts the
 * Tier 1.A `prefetch={false}` invariant). This file asserts the
 * Layer 4 addition: every heavy-target dashboard `<Link>` ALSO
 * carries `data-hover-prefetch="true"` so the route warms on
 * intent (hover / focus / pointer-down) instead of on mount.
 *
 * What we assert:
 *
 *   1. Ribbon chips (N-of-N container) carry
 *      `data-hover-prefetch="true"` AND `data-prefetch="false"`.
 *      Both markers must hold simultaneously — that's the whole
 *      Layer 4 contract (no mount prefetch + intent prefetch).
 *   2. Ribbon's "Open scanner" empty-state CTA carries both.
 *   3. Day Desk per-row "Open Day Signals →" links carry both.
 *   4. Day Desk footer "View day scanner →" carries both.
 *   5. Swing Desk footer "View swing scanner →" carries both.
 *
 * If a future refactor drops either marker the failure pinpoints
 * which invariant was broken and points the reader at this doc.
 */

import type { ReactElement, AnchorHTMLAttributes } from "react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/hooks/use-is-mobile-layout", () => ({
  useIsMobileLayout: () => false
}));

// `useHoverPrefetch` calls `useRouter()` from `next/navigation` to
// get a default router. In jsdom (no app-router context) the real
// hook throws "invariant expected app router to be mounted". We
// mock it to a stub since this test only cares about the DOM
// markers (`data-prefetch`, `data-hover-prefetch`), not that
// `prefetch()` is actually called.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: vi.fn() })
}));

// Same `next/link` mock pattern as `dashboard-prefetch.test.tsx` —
// surface `prefetch` as a DOM attr. The real Next.js `<Link>` would
// swallow it. Other props (onMouseEnter, onFocus, etc.) flow
// through naturally to the underlying anchor.
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
 * Hard assertion: the anchor MUST carry both
 * `data-prefetch="false"` (Tier 1.A) AND
 * `data-hover-prefetch="true"` (Layer 4). The combination is the
 * whole point of Layer 4: no mount-time speculation, but warm the
 * route on intent.
 */
function assertLayer4Link(anchor: HTMLAnchorElement | null, label: string) {
  expect(anchor, `${label} anchor must exist`).not.toBeNull();
  const dp = anchor!.getAttribute("data-prefetch");
  expect(
    dp,
    `${label} MUST keep prefetch={false} (Tier 1.A). Got "${dp}".`
  ).toBe("false");
  const dh = anchor!.getAttribute("data-hover-prefetch");
  expect(
    dh,
    `${label} MUST carry data-hover-prefetch="true" (Layer 4). ` +
      `Got "${dh}". Drop this marker and the route stops warming on intent — ` +
      `see docs/PERFORMANCE.md §4C.`
  ).toBe("true");
}

describe("Layer 4 — dashboard hover-prefetch markers", () => {
  test("ribbon chip carries both Tier 1.A and Layer 4 markers", () => {
    const chipSetup: IntradaySetupPayload = {
      symbol: "AAPL",
      direction: "long",
      score: 0.82,
      scanner_mode: "swing_daily",
      company_name: "Apple Inc.",
      timestamp_iso: "2026-05-13T18:00:00Z",
      triggers: ["gap up"]
    } as unknown as IntradaySetupPayload;
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={{ ...baseScanner, setups: [chipSetup] }}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    const chip = screen.getByTestId("ribbon-chip-AAPL") as HTMLAnchorElement;
    assertLayer4Link(chip, 'ribbon chip "AAPL"');
  });

  test("ribbon empty-state 'Open scanner' CTA carries both markers", () => {
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
    expect(ribbon.getAttribute("data-ribbon-state")).toBe("empty");
    const openScanner = ribbon.querySelector(
      'a[href="/dashboard/scanner"]'
    ) as HTMLAnchorElement | null;
    assertLayer4Link(openScanner, "ribbon empty-state Open scanner");
  });

  test("Day Desk per-row Open Day Signals link carries both markers", () => {
    const daySetup: IntradaySetupPayload = {
      symbol: "TSLA",
      direction: "bullish",
      score: 0.75,
      scanner_mode: "intraday",
      company_name: "Tesla Inc.",
      timestamp_iso: "2026-05-13T18:00:00Z"
    } as unknown as IntradaySetupPayload;
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
    const dayDeskRoot = screen.getByTestId("day-desk-panel");
    const dayRowLink = dayDeskRoot.querySelector(
      'a[href*="trading_mode=day"][href*="symbol=TSLA"]'
    ) as HTMLAnchorElement | null;
    assertLayer4Link(dayRowLink, 'Day Desk row "TSLA" Open Day Signals');
  });

  test("Day Desk footer 'View day scanner' carries both markers", () => {
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
    const dayDeskRoot = screen.getByTestId("day-desk-panel");
    const dayFooter = dayDeskRoot.querySelector(
      'a[href="/dashboard/scanner?mode=day"]'
    ) as HTMLAnchorElement | null;
    assertLayer4Link(dayFooter, "Day Desk footer View day scanner");
  });

  test("Swing Desk footer 'View swing scanner' carries both markers", () => {
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
    // `swing-desk-scanner-footer` is the wrapper <div>; the actual
    // <Link> is the first anchor inside.
    const swingFooterWrap = screen.getByTestId("swing-desk-scanner-footer");
    const swingFooter = swingFooterWrap.querySelector(
      'a[href="/dashboard/scanner?mode=swing"]'
    ) as HTMLAnchorElement | null;
    assertLayer4Link(swingFooter, "Swing Desk footer View swing scanner");
  });
});
