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
 * What we assert (focus-layout dashboard):
 *
 *   1. Desk status "Swing scanner →" and "Day scanner →" carry
 *      both `data-prefetch="false"` and `data-hover-prefetch="true"`.
 *   2. Next actions "Open Scanner →", "View Watchlist →", and "Signals →" carry both.
 *   3. Watchlist status strip "View watchlist →" carries both when rendered.
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
import type { ScannerOverview } from "@/lib/api/scanner";

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

function anchorByHref(root: HTMLElement, href: string): HTMLAnchorElement | null {
  return root.querySelector(`a[href="${href}"]`) as HTMLAnchorElement | null;
}

describe("Layer 4 — dashboard hover-prefetch markers", () => {
  test("desk status swing and day scanner carry Tier 1.A + Layer 4 markers", () => {
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
    assertLayer4Link(anchorByHref(desk, "/dashboard/scanner?mode=swing"), "desk Swing scanner");
    assertLayer4Link(anchorByHref(desk, "/dashboard/scanner?mode=day"), "desk Day scanner");
  });

  test("next actions open scanner and watchlist carry Tier 1.A + Layer 4 markers", () => {
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
    const next = screen.getByTestId("dashboard-next-actions");
    assertLayer4Link(anchorByHref(next, "/dashboard/scanner?mode=swing"), "next actions Open Scanner");
    assertLayer4Link(anchorByHref(next, "/dashboard/watchlists"), "next actions View Watchlist");
    assertLayer4Link(anchorByHref(next, "/dashboard/signals"), "next actions Signals");
  });

  test("watchlist strip link carries Tier 1.A + Layer 4 markers when strip renders", () => {
    const scannerWithWatchlist: ScannerOverview = {
      ...baseScanner,
      watchlistStatus: { monitored: 2, actionable: 0, developing: 1, inactive: 1 }
    };
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={scannerWithWatchlist}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    const strip = screen.getByTestId("dashboard-watchlist-status");
    const watchlist = Array.from(strip.querySelectorAll("a")).find((a) =>
      /view watchlist/i.test(a.textContent || "")
    ) as HTMLAnchorElement | null;
    assertLayer4Link(watchlist, "watchlist strip View watchlist");
  });
});
