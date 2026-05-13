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
 * over one connection. Root cause: every `<Link>` in the ribbon,
 * day-desk top-signal rows, and desk scanner footers omitted the
 * `prefetch={false}` flag, so Next.js 14.2's default
 * `prefetch="auto"` behaviour speculatively SSR-rendered the
 * heaviest target in the app (`/dashboard/signals`) once per
 * visible link on mount.
 *
 * The fix is one attribute per Link. The risk is regression — a
 * future refactor could trivially drop the flag and re-introduce
 * the prefetch storm without anyone noticing until the dashboard
 * feels sluggish again. These tests pin the attribute presence so
 * a regression breaks CI loudly, with a comment pointing at this
 * doc.
 *
 * What we assert:
 *
 *   1. Ribbon chips (N-of-N container, biggest offender) carry
 *      `prefetch={false}`.
 *   2. Ribbon's "Open scanner" CTA in the empty state carries
 *      `prefetch={false}`.
 *   3. Day Desk's per-row "Open Day Signals →" link carries
 *      `prefetch={false}` for every populated top-signal row.
 *   4. Day Desk footer "View day scanner →" carries
 *      `prefetch={false}`.
 *   5. Swing Desk footer "View swing scanner →" carries
 *      `prefetch={false}`.
 *
 * What we deliberately do NOT assert:
 *
 *   * That the sidebar / top-bar nav links carry `prefetch={false}`.
 *     Those are 1-of-N targets (one Settings link, one Performance
 *     link, etc.), not N-of-N like the ribbon. Next.js's default
 *     prefetch is fine for those.
 *
 *   * That clicking a link still navigates. `prefetch={false}` is
 *     a routing optimization flag — it doesn't affect click
 *     behaviour. Covered transitively by the existing
 *     `dashboard-scanner-mode-links.test.tsx` and
 *     `dashboard-redesign-phase-b-c.test.tsx` suites which verify
 *     `href` values.
 */

import type { ReactElement, AnchorHTMLAttributes } from "react";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

// ─────────────────────────────────────────────────────────────────────────────
// (1) Ribbon chips — the dominant offender pre-fix.
// ─────────────────────────────────────────────────────────────────────────────

describe("Active Signal Ribbon chips (Tier 1.A prefetch invariant)", () => {
  test("ribbon_chips_carry_prefetch_false_when_both_modes_have_setups", () => {
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
    const ribbon = screen.getByTestId("dashboard-active-signal-ribbon");
    const chips = Array.from(ribbon.querySelectorAll("a")).filter((a) =>
      (a.getAttribute("data-testid") || "").startsWith("ribbon-chip-")
    ) as HTMLAnchorElement[];
    expect(chips.length).toBeGreaterThan(0);
    // Every ribbon chip MUST disable speculative prefetch — they
    // are N-of-N pointers at the heaviest SSR page in the app.
    chips.forEach((a) =>
      assertLinkHasPrefetchDisabled(a, `ribbon chip ${a.getAttribute("data-testid")}`)
    );
  });

  test("ribbon_empty_state_open_scanner_cta_carries_prefetch_false", () => {
    // Empty state: no setups -> ribbon renders its "Watching for…"
    // line + "Open scanner →" link. That link points at
    // `/dashboard/scanner` (a heavy SSR target) and must also be
    // exempt from speculative prefetch.
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
    const openScannerLink = Array.from(ribbon.querySelectorAll("a")).find((a) =>
      /open scanner/i.test(a.textContent || "")
    ) as HTMLAnchorElement | undefined;
    assertLinkHasPrefetchDisabled(openScannerLink ?? null, "ribbon empty-state Open Scanner");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (2) Day Desk top-signal rows + scanner footer.
// ─────────────────────────────────────────────────────────────────────────────

describe("Day Desk panel (Tier 1.A prefetch invariant)", () => {
  test("each_day_top_signal_row_open_day_signals_link_carries_prefetch_false", () => {
    // Populate the day side with two intraday setups so the desk
    // renders its top-signal row pair.
    const dayA: IntradaySetupPayload = {
      symbol: "DAYTOP1",
      direction: "bullish",
      score: 0.81,
      triggers: ["orb_breakout"],
      timestamp_iso: "2026-05-01T14:30:00Z"
    };
    const dayB: IntradaySetupPayload = {
      symbol: "DAYTOP2",
      direction: "bullish",
      score: 0.79,
      triggers: ["orb_breakout"],
      timestamp_iso: "2026-05-01T14:35:00Z"
    };
    wrap(
      <DashboardRedesign
        marketOverview={baseMarket}
        scannerOverview={{ ...baseScanner, setups: [dayA, dayB] }}
        earningsEvents={[]}
        earningsRecent={[]}
        weeklyIndexRows={baseWeekly}
        sectorRotation={[]}
      />
    );
    const dayPanel = screen.getByTestId("day-desk-panel");
    const signalLinks = Array.from(dayPanel.querySelectorAll("a")).filter((a) =>
      /open day signals/i.test(a.textContent || "")
    ) as HTMLAnchorElement[];
    expect(signalLinks.length).toBeGreaterThan(0);
    signalLinks.forEach((a) => {
      // href must still be the signals page — we don't break
      // navigation, we just disable speculative prefetch.
      expect(a.getAttribute("href") || "").toContain("/dashboard/signals?symbol=");
      assertLinkHasPrefetchDisabled(a, `day-row link to ${a.getAttribute("href")}`);
    });
  });

  test("day_desk_footer_view_day_scanner_link_carries_prefetch_false", () => {
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
    const footerLink = Array.from(dayPanel.querySelectorAll("a")).find((a) =>
      /view day scanner/i.test(a.textContent || "")
    ) as HTMLAnchorElement | undefined;
    expect(footerLink, "day desk footer link must exist").toBeTruthy();
    expect(footerLink?.getAttribute("href")).toBe("/dashboard/scanner?mode=day");
    assertLinkHasPrefetchDisabled(footerLink ?? null, "day desk scanner footer");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (3) Swing Desk footer.
// ─────────────────────────────────────────────────────────────────────────────

describe("Swing Desk panel (Tier 1.A prefetch invariant)", () => {
  test("swing_desk_footer_view_swing_scanner_link_carries_prefetch_false", () => {
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
    const footerLink = footer.querySelector("a") as HTMLAnchorElement | null;
    expect(footerLink, "swing desk footer link must exist").toBeTruthy();
    expect(footerLink?.getAttribute("href")).toBe("/dashboard/scanner?mode=swing");
    assertLinkHasPrefetchDisabled(footerLink, "swing desk scanner footer");
  });
});
