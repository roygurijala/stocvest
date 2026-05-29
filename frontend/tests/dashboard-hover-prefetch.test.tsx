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
 */

import type { ReactElement, AnchorHTMLAttributes } from "react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/hooks/use-is-mobile-layout", () => ({
  useIsMobileLayout: () => false
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() })
}));

vi.mock("@/lib/hooks/use-dashboard-desk-refresh", () => ({
  useDashboardDeskRefresh: () => ({
    data: null,
    isLoading: false,
    isValidating: false,
    error: null,
    mutate: vi.fn(),
    refreshDesk: vi.fn(),
    manualRefreshBusy: false,
    canManualRefresh: true,
    cooldownRemainingMs: 0,
    cooldownLabel: null,
    refreshError: null
  })
}));

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

function assertLayer4Link(anchor: HTMLAnchorElement | null, label: string) {
  expect(anchor, `${label} anchor must exist`).not.toBeNull();
  expect(anchor!.getAttribute("data-prefetch")).toBe("false");
  expect(anchor!.getAttribute("data-hover-prefetch")).toBe("true");
}

function anchorByHref(root: HTMLElement, href: string): HTMLAnchorElement | null {
  return root.querySelector(`a[href="${href}"]`) as HTMLAnchorElement | null;
}

describe("Layer 4 — dashboard hover-prefetch markers", () => {
  test("opportunities_and_live_status_carry_Tier_1A_and_Layer_4_markers", () => {
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
    assertLayer4Link(
      anchorByHref(discovery, "/dashboard/scanner?mode=day"),
      "discovery Open Scanner"
    );
    assertLayer4Link(
      anchorByHref(screen.getByTestId("dashboard-watchlist-radar"), "/dashboard/watchlists?desk=day"),
      "watchlist radar"
    );
  });

  test("scanner_card_href_follows_desk_mode_pill_with_layer_4_markers", () => {
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
    assertLayer4Link(
      anchorByHref(discovery, "/dashboard/scanner?mode=swing"),
      "discovery Open Scanner (swing)"
    );
  });
});
