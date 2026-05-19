import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { ScannerPageClient } from "@/components/scanner-page-client";
import { ThemeProvider } from "@/lib/theme-provider";

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

const SCANNER_MODE_STORAGE_KEY = "stocvest_scanner_mode";

const { loadScannerDataWithoutBriefMock } = vi.hoisted(() => ({
  loadScannerDataWithoutBriefMock: vi.fn(async () => ({
    gapIntelligence: [] as import("@/lib/api/scanner").GapIntelligenceItem[],
    setups: [] as import("@/lib/api/scanner").IntradaySetupPayload[],
    spyPct: null as number | null,
    qqqPct: null as number | null,
    regimeLabel: "Neutral"
  }))
}));

vi.mock("@/lib/api/scanner-client-load", () => ({
  loadScannerDataWithoutBrief: loadScannerDataWithoutBriefMock
}));

vi.mock("@/lib/api/earnings-client", () => ({
  fetchEarningsCalendarClient: vi.fn(async () => ({
    symbols: [] as string[],
    days: 2,
    upcoming: [],
    recent: [],
    notice: null as string | null
  }))
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn()
  })
}));

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

const EMPTY_SCANNER_PAYLOAD = {
  gapIntelligence: [] as import("@/lib/api/scanner").GapIntelligenceItem[],
  setups: [] as import("@/lib/api/scanner").IntradaySetupPayload[],
  spyPct: null as number | null,
  qqqPct: null as number | null,
  regimeLabel: "Neutral"
};

describe("ScannerPageClient setup mode toggle", () => {
  beforeEach(() => {
    loadScannerDataWithoutBriefMock.mockReset();
    loadScannerDataWithoutBriefMock.mockImplementation(async () => ({ ...EMPTY_SCANNER_PAYLOAD }));
    localStorage.clear();
    // Reset jsdom URL between tests so `?mode=` left over from a
    // previous test (the URL-priority resolver now reads/writes this)
    // cannot bleed into the next test's initial state.
    try {
      window.history.replaceState(null, "", "/");
    } catch {
      /* ignore — jsdom always supports this */
    }
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  test("test_scanner_mode_toggle_default_swing", async () => {
    wrap(
      <ScannerPageClient
        initialOverview={{ gapIntelligence: [], setups: [] }}
        initialTimestampIso="2026-05-06T12:00:00.000Z"
        earningsBySymbol={{}}
      />
    );
    const swing = screen.getByRole("tab", { name: "Swing" });
    await waitFor(() => expect(swing).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("tab", { name: "Day" })).toHaveAttribute("aria-selected", "false");
  });

  test("test_scanner_mode_persisted_in_localstorage", async () => {
    const ui = (
      <ScannerPageClient
        initialOverview={{ gapIntelligence: [], setups: [] }}
        initialTimestampIso="2026-05-06T12:00:00.000Z"
        earningsBySymbol={{}}
      />
    );
    const r1 = wrap(ui);
    fireEvent.click(screen.getByRole("tab", { name: "Day" }));
    await waitFor(() => expect(localStorage.getItem(SCANNER_MODE_STORAGE_KEY)).toBe("day"));
    r1.unmount();

    wrap(ui);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Day" })).toHaveAttribute("aria-selected", "true"));
  });

  test("test_scanner_mode_both_renders_two_separate_sections_not_merged_list", async () => {
    // Mode-separation safety perimeter (assistant_prompts.py): when the user
    // picks "Both", scanner output must render as TWO sections (Swing setups
    // + Day setups), NOT a single merged ranked list sorted across engines.
    // Lock-in: feed a mix where day's top score (0.9) exceeds swing's top
    // (0.7) — if the implementation regressed to a single merge-sorted list,
    // we'd see "DAYA" before "SWINGA" with no section headers at all.
    localStorage.setItem(SCANNER_MODE_STORAGE_KEY, "both");
    const mixedSetups: import("@/lib/api/scanner").IntradaySetupPayload[] = [
      {
        symbol: "SWINGA",
        direction: "long",
        score: 0.5,
        triggers: ["ema50_cross_above_200"],
        timestamp_iso: "2026-05-01T12:00:00Z",
        scanner_mode: "swing_daily",
        pattern_maturity_days: 4
      },
      {
        symbol: "DAYA",
        direction: "long",
        score: 0.9,
        triggers: ["orb_break"],
        timestamp_iso: "2026-05-01T14:00:00Z"
      },
      {
        symbol: "SWINGB",
        direction: "long",
        score: 0.7,
        triggers: ["weekly_rsi_recovery"],
        timestamp_iso: "2026-05-01T12:30:00Z",
        scanner_mode: "swing_daily"
      },
      {
        symbol: "DAYB",
        direction: "long",
        score: 0.4,
        triggers: ["vwap_reclaim"],
        timestamp_iso: "2026-05-01T14:30:00Z"
      }
    ];
    // Sticky impl so every refetch (initial swing render + post-localStorage
    // swap to both + any later refresh) gets the same dataset.
    loadScannerDataWithoutBriefMock.mockImplementation(async () => ({
      ...EMPTY_SCANNER_PAYLOAD,
      setups: mixedSetups
    }));

    wrap(
      <ScannerPageClient
        initialOverview={{ gapIntelligence: [], setups: [] }}
        initialTimestampIso="2026-05-06T12:00:00.000Z"
        earningsBySymbol={{}}
      />
    );

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Both" })).toHaveAttribute("aria-selected", "true")
    );

    // Both engine-labelled section headers must be present.
    const swingHeader = await screen.findByText("Swing setups (daily cadence)");
    const dayHeader = await screen.findByText("Day setups (intraday cadence)");

    // Swing section must precede Day section in DOM order — engines never
    // interleave.
    const order =
      swingHeader.compareDocumentPosition(dayHeader) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(order).toBeTruthy();

    // Symbols from each engine must surface (proves both sections render rows,
    // not just headers).
    expect(screen.getByText("SWINGA")).toBeTruthy();
    expect(screen.getByText("SWINGB")).toBeTruthy();
    expect(screen.getByText("DAYA")).toBeTruthy();
    expect(screen.getByText("DAYB")).toBeTruthy();
  });

  test("test_scanner_mode_url_param_overrides_localstorage", async () => {
    // Regression: the dashboard's Day Desk "View day scanner →" link
    // sends users to `/dashboard/scanner?mode=day`, but the scanner page
    // used to ignore the URL and read from localStorage only — so a
    // user whose last visit was swing-mode would land on Swing every
    // time, defeating the deep-link. The fix: URL `?mode=` has
    // priority over localStorage. This test pins the priority.
    localStorage.setItem(SCANNER_MODE_STORAGE_KEY, "swing");
    window.history.replaceState(null, "", "/dashboard/scanner?mode=day");

    wrap(
      <ScannerPageClient
        initialOverview={{ gapIntelligence: [], setups: [] }}
        initialTimestampIso="2026-05-06T12:00:00.000Z"
        earningsBySymbol={{}}
      />
    );

    // URL wins — Day tab is selected even though localStorage said swing.
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Day" })).toHaveAttribute("aria-selected", "true")
    );
    // And the URL preference is mirrored into localStorage so the next
    // visit without a URL hint stays on Day (sticky deep-link behaviour).
    expect(localStorage.getItem(SCANNER_MODE_STORAGE_KEY)).toBe("day");

    // Reset the URL so it doesn't leak into the next test.
    window.history.replaceState(null, "", "/");
  });

  test("test_scanner_mode_url_param_swing_lands_on_swing_tab", async () => {
    // Symmetric to the day case — the new Swing Desk "View swing
    // scanner →" link sends users to `?mode=swing` and must land on
    // the Swing tab regardless of any prior localStorage state.
    localStorage.setItem(SCANNER_MODE_STORAGE_KEY, "day");
    window.history.replaceState(null, "", "/dashboard/scanner?mode=swing");

    wrap(
      <ScannerPageClient
        initialOverview={{ gapIntelligence: [], setups: [] }}
        initialTimestampIso="2026-05-06T12:00:00.000Z"
        earningsBySymbol={{}}
      />
    );

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Swing" })).toHaveAttribute("aria-selected", "true")
    );
    expect(localStorage.getItem(SCANNER_MODE_STORAGE_KEY)).toBe("swing");
    window.history.replaceState(null, "", "/");
  });

  test("test_scanner_mode_invalid_url_param_falls_back_to_localstorage", async () => {
    // Graceful fallback — a garbage `?mode=foo` from a malformed external
    // link must NOT clear or corrupt the user's saved preference. The
    // resolver should ignore the URL value and fall through to
    // localStorage.
    localStorage.setItem(SCANNER_MODE_STORAGE_KEY, "day");
    window.history.replaceState(null, "", "/dashboard/scanner?mode=foo");

    wrap(
      <ScannerPageClient
        initialOverview={{ gapIntelligence: [], setups: [] }}
        initialTimestampIso="2026-05-06T12:00:00.000Z"
        earningsBySymbol={{}}
      />
    );

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Day" })).toHaveAttribute("aria-selected", "true")
    );
    // localStorage value untouched.
    expect(localStorage.getItem(SCANNER_MODE_STORAGE_KEY)).toBe("day");
    window.history.replaceState(null, "", "/");
  });

  test("test_scanner_mode_both_uses_mode_specific_empty_state_copy", async () => {
    // Mode-aware empty-state language rule (assistant_prompts.py): when a
    // mode is suppressed in the both-view, its empty copy must use that
    // mode's vocabulary — swing emphasises regime / structure alignment,
    // day emphasises intraday confirmation / session timing. Never identical.
    //
    // Under the new rich empty state (<ScannerEmptyStateCard />), each
    // mode renders its own card with mode-discriminated copy. We assert:
    //   1. Both cards exist (one per mode) in the both-view.
    //   2. Each card carries a `data-mode` matching its render group.
    //   3–4. Each card uses mode-specific interpretive mechanism copy
    //      (quiet days hide desk pill rows; discrimination is copy + data-mode).
    //   5. Neither card leaks the other mode's vocabulary (this is the
    //      hard rule — a copy edit that swaps them would silently break
    //      Mode Separation, so we pin it here).
    localStorage.setItem(SCANNER_MODE_STORAGE_KEY, "both");
    // Empty defaults are already installed by beforeEach; no override needed.

    wrap(
      <ScannerPageClient
        initialOverview={{ gapIntelligence: [], setups: [] }}
        initialTimestampIso="2026-05-06T12:00:00.000Z"
        earningsBySymbol={{}}
      />
    );

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Both" })).toHaveAttribute("aria-selected", "true")
    );

    const swingCard = await screen.findByTestId("scanner-setups-empty-state-swing");
    const dayCard = await screen.findByTestId("scanner-setups-empty-state-day");
    expect(swingCard.getAttribute("data-mode")).toBe("swing");
    expect(dayCard.getAttribute("data-mode")).toBe("day");
    expect(swingCard.textContent).toMatch(
      /Setup conditions not fully aligned|Structure \+ regime|Per-symbol confirmation/i
    );
    expect(dayCard.textContent).toMatch(/Intraday gates not cleared|Session closed/i);
    expect(swingCard.textContent?.toLowerCase()).not.toContain("intraday confirmation");
    expect(dayCard.textContent?.toLowerCase()).not.toContain("regime alignment");
  });
});

describe("ScannerPageClient Swing Pro (dayTradingSurfaces=false)", () => {
  test("does not render mode tablist or day/both tabs; shows plan banner", async () => {
    wrap(
      <ScannerPageClient
        initialOverview={{ gapIntelligence: [], setups: [] }}
        initialTimestampIso="2026-05-06T12:00:00.000Z"
        earningsBySymbol={{}}
        dayTradingSurfaces={false}
      />
    );
    expect(screen.queryByTestId("scanner-mode-tablist")).toBeNull();
    expect(screen.getByTestId("scanner-swing-pro-plan-banner")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Day" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Both" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Swing" })).toBeNull();
    await waitFor(() => expect(loadScannerDataWithoutBriefMock).toHaveBeenCalled());
    const swingCalls = loadScannerDataWithoutBriefMock.mock.calls.filter(
      (c) => c[2]?.scannerSetupLoadMode === "swing"
    );
    expect(swingCalls.length).toBeGreaterThan(0);
  });

  test("coerces day URL and localStorage to swing when plan excludes day surfaces", async () => {
    localStorage.setItem(SCANNER_MODE_STORAGE_KEY, "day");
    window.history.replaceState(null, "", "/dashboard/scanner?mode=day");

    wrap(
      <ScannerPageClient
        initialOverview={{ gapIntelligence: [], setups: [] }}
        initialTimestampIso="2026-05-06T12:00:00.000Z"
        earningsBySymbol={{}}
        dayTradingSurfaces={false}
      />
    );

    await waitFor(() => expect(localStorage.getItem(SCANNER_MODE_STORAGE_KEY)).toBe("swing"));
    expect(window.location.search).toContain("mode=swing");

    window.history.replaceState(null, "", "/");
  });
});
