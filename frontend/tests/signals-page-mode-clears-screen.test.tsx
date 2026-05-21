/**
 * Lock-in tests for the Signals page mode-toggle clear-screen contract.
 *
 * Bug being pinned (reported by the user, 2026-05-12):
 *
 *   "On signals page, when you switch between day trade and swing trade,
 *    we need to clear the screen before displaying the other. Right now,
 *    it is very confusing if we don't clear the screen between switching."
 *
 * Root cause: `tradingMode` flipped synchronously on click, but the
 * `compositeResult` / `signalEvidence` / `radarData` / `historyRows`
 * states kept their old-mode values until the new mode's fetch resolved.
 * So for a brief but visually loud window, the user saw the new mode
 * pill highlighted while the *old* mode's 6-layer breakdown, radar,
 * evidence, and history rows were still on screen — a mode-mixing
 * violation of the Mode Separation rule from `ASSISTANT_SYSTEM_PROMPT`.
 *
 * Fix: `updateTradingMode` now wipes mode-bound state synchronously
 * before flipping `tradingMode`. The 6-Layer Signal Breakdown shows a
 * `CuteLoader` (data-testid `signals-layers-loader`) while the new
 * composite is in-flight, instead of the rows.map fallback that
 * defaults to six "Unavailable" cards from `layerMeta`.
 *
 * These tests pin the user-visible contract — not the internal
 * implementation — so a future refactor that ships the same behaviour
 * by a different path (e.g. an effect on `[tradingMode]` instead of
 * an inline clear) keeps these tests green.
 */

import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { SWRConfig } from "swr";

vi.mock("@/lib/hooks/use-is-mobile-layout", () => ({
  useIsMobileLayout: () => false
}));

vi.mock("@/lib/assistant/context", () => ({
  usePublishAssistantContext: () => undefined
}));

vi.mock("@/lib/hooks/use-signals-mount-revalidate", () => ({
  useSignalsMountRevalidate: () => ({ isMountRevalidating: false })
}));

// Recharts isn't exercised by these tests (radar starts collapsed and
// we never expand it) but importing the file still registers the
// component tree. We don't need to mock recharts.

const apiMocks = vi.hoisted(() => ({
  fetchSymbolNews: vi.fn(async () => []),
  fetchSymbolSnapshot: vi.fn(async () => null),
  fetchUserEvaluatedSignals: vi.fn(async () => null),
  fetchLiveSignals: vi.fn(async () => [])
}));

vi.mock("@/lib/api/fetch-symbol-news", () => ({
  fetchSymbolNews: apiMocks.fetchSymbolNews
}));

vi.mock("@/lib/api/fetch-symbol-snapshot", () => ({
  fetchSymbolSnapshot: apiMocks.fetchSymbolSnapshot
}));

vi.mock("@/lib/api/public-signals", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/public-signals")>(
    "@/lib/api/public-signals"
  );
  return {
    ...actual,
    fetchUserEvaluatedSignals: apiMocks.fetchUserEvaluatedSignals,
    fetchLiveSignals: apiMocks.fetchLiveSignals
  };
});

import { SignalsPageClient } from "@/components/signals-page-client";
import { ThemeProvider } from "@/lib/theme-provider";
import type { MarketOverview } from "@/lib/api/market";
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

const fetchMock = vi.fn();
const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  apiMocks.fetchSymbolNews.mockReset().mockResolvedValue([]);
  apiMocks.fetchSymbolSnapshot.mockReset().mockResolvedValue(null);
  apiMocks.fetchUserEvaluatedSignals.mockReset().mockResolvedValue(null);
  apiMocks.fetchLiveSignals.mockReset().mockResolvedValue([]);
  global.fetch = fetchMock as unknown as typeof global.fetch;
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  global.fetch = ORIGINAL_FETCH;
});

function wrap(ui: ReactElement) {
  // Each test gets its OWN SWR cache (a fresh `Map`) so cached
  // payloads from a previous test don't make a fresh cache-key
  // transition skip the loader phase. The "clear screen between
  // modes" UX rule applies to UNCACHED flips — once a (symbol,
  // mode) is in cache, returning to it is instant (a strictly
  // better UX). These lock-ins pin the uncached behaviour to
  // catch the regression class the user originally reported.
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ThemeProvider>{ui}</ThemeProvider>
    </SWRConfig>
  );
}

const EMPTY_MARKET_OVERVIEW: MarketOverview = {
  snapshots: [],
  macro: undefined,
  market_status: undefined
} as unknown as MarketOverview;

const EMPTY_SCANNER_OVERVIEW: ScannerOverview = {
  gapIntelligence: [],
  setups: []
} as ScannerOverview;

/**
 * Build a composite payload shaped like the upstream
 * `/v1/signals/composite/{mode}` response — enough fields for the
 * Signals page's `rows` useMemo + `isInsufficientCompositeResponse`
 * gate to recognise it as a valid signal.
 */
function compositePayload(args: {
  summary: "Bullish" | "Bearish" | "Neutral";
  /** A unique substring we can grep the DOM for to prove "this mode rendered, the other did not". */
  fingerprint: string;
}) {
  const { summary, fingerprint } = args;
  const verdictBull = summary === "Bullish" ? "bullish" : summary === "Bearish" ? "bearish" : "neutral";
  return {
    signal_summary: summary.toLowerCase(),
    alignment_ratio: 0.62,
    signal_strength: 0.6,
    signal_score: 64,
    risk_reward: 2.2,
    layers: [
      {
        layer: "technical",
        verdict: verdictBull,
        status: "active",
        score: 72,
        reasoning: `${fingerprint} — technical reasoning marker`
      },
      {
        layer: "news",
        verdict: "neutral",
        status: "active",
        score: 50,
        reasoning: `${fingerprint} — news reasoning marker`
      },
      {
        layer: "macro",
        verdict: verdictBull,
        status: "active",
        score: 58,
        reasoning: `${fingerprint} — macro reasoning marker`
      },
      {
        layer: "sector",
        verdict: verdictBull,
        status: "active",
        score: 60,
        reasoning: `${fingerprint} — sector reasoning marker`
      },
      {
        layer: "geopolitical",
        verdict: "neutral",
        status: "active",
        score: 50,
        reasoning: `${fingerprint} — geopolitical reasoning marker`
      },
      {
        layer: "internals",
        verdict: verdictBull,
        status: "active",
        score: 55,
        reasoning: `${fingerprint} — internals reasoning marker`
      }
    ]
  };
}

function mockCompositeOk(payload: ReturnType<typeof compositePayload>): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function renderSignalsWithSymbol(symbol: string, initialMode: "swing" | "day" = "swing") {
  return wrap(
    <SignalsPageClient
      marketOverview={EMPTY_MARKET_OVERVIEW}
      scannerOverview={EMPTY_SCANNER_OVERVIEW}
      signalsPrefill={{
        urlSymbol: symbol,
        signalIdForResolve: null,
        hadSignalIdQuery: false,
        initialTradingMode: initialMode
      }}
    />
  );
}

describe("SignalsPageClient — mode toggle clears the screen (load-bearing UX guard)", () => {
  test("toggling from swing → day removes the swing 6-layer breakdown before the day fetch resolves", async () => {
    const swingPayload = compositePayload({ summary: "Bullish", fingerprint: "SWING_FP" });
    const dayPayload = compositePayload({ summary: "Bearish", fingerprint: "DAY_FP" });

    // First fetch (swing composite on mount) — resolve immediately.
    // Second fetch (day composite after toggle) — we hold the
    // promise so we can assert the in-flight loader state before it
    // resolves.
    let releaseDayFetch: (response: Response) => void = () => {};
    const dayFetchPromise = new Promise<Response>((resolve) => {
      releaseDayFetch = resolve;
    });

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : String(input);
      if (url.endsWith("/api/stocvest/signals/composite/swing")) {
        return mockCompositeOk(swingPayload);
      }
      if (url.endsWith("/api/stocvest/signals/composite/real")) {
        // Day-mode endpoint — return the controlled promise so the
        // test can pin the in-flight state.
        return dayFetchPromise;
      }
      // Anything else (watchlists, news fan-out) is best-effort.
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    renderSignalsWithSymbol("AAPL", "swing");

    // Initial swing composite lands → setup read shows swing bias.
    await waitFor(() =>
      expect(screen.getByTestId("signals-setup-bias")).toHaveTextContent("Bullish")
    );

    // Click the Day trade tab.
    fireEvent.click(screen.getByRole("tab", { name: /^Day$/i }));

    // SYNCHRONOUSLY after the click, the swing rows MUST be gone and
    // the loader MUST be visible. We use a tight assertion (no async
    // waitFor) because the contract is: state is cleared on the
    // *click handler*, not after some downstream effect.
    expect(screen.queryByTestId("signals-setup-bias")).toBeNull();
    expect(screen.getByTestId("signals-setup-loading")).toBeTruthy();

    // The day-mode fetch is still in flight — setup read not shown yet.
    expect(screen.queryByTestId("signals-setup-bias")).toBeNull();

    // Resolve the day fetch and assert the new mode lands.
    releaseDayFetch(mockCompositeOk(dayPayload));
    await waitFor(() =>
      expect(screen.getByTestId("signals-setup-bias")).toHaveTextContent("Bearish")
    );
    // And the loader is gone now that the data is in.
    expect(screen.queryByTestId("signals-setup-loading")).toBeNull();
  });

  test("toggling day → swing also clears immediately (symmetric)", async () => {
    const dayPayload = compositePayload({ summary: "Bearish", fingerprint: "DAY_FP" });
    const swingPayload = compositePayload({ summary: "Bullish", fingerprint: "SWING_FP" });

    let releaseSwingFetch: (response: Response) => void = () => {};
    const swingFetchPromise = new Promise<Response>((resolve) => {
      releaseSwingFetch = resolve;
    });

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : String(input);
      if (url.endsWith("/api/stocvest/signals/composite/real")) {
        return mockCompositeOk(dayPayload);
      }
      if (url.endsWith("/api/stocvest/signals/composite/swing")) {
        return swingFetchPromise;
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    renderSignalsWithSymbol("AAPL", "day");

    await waitFor(() =>
      expect(screen.getByTestId("signals-setup-bias")).toHaveTextContent("Bearish")
    );

    fireEvent.click(screen.getByRole("tab", { name: /^Swing$/i }));

    expect(screen.queryByTestId("signals-setup-bias")).toBeNull();
    expect(screen.getByTestId("signals-setup-loading")).toBeTruthy();

    releaseSwingFetch(mockCompositeOk(swingPayload));
    await waitFor(() =>
      expect(screen.getByTestId("signals-setup-bias")).toHaveTextContent("Bullish")
    );
    expect(screen.queryByTestId("signals-setup-loading")).toBeNull();
  });

  test("clicking the currently-selected mode is a no-op (does not flash the loader)", async () => {
    const swingPayload = compositePayload({ summary: "Bullish", fingerprint: "SWING_FP" });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : String(input);
      if (url.endsWith("/api/stocvest/signals/composite/swing")) {
        return mockCompositeOk(swingPayload);
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    renderSignalsWithSymbol("AAPL", "swing");
    await waitFor(() =>
      expect(screen.getByTestId("signals-setup-bias")).toHaveTextContent("Bullish")
    );

    const swingFetchCountBefore = fetchMock.mock.calls.filter((c) =>
      String(c[0] ?? "").endsWith("/api/stocvest/signals/composite/swing")
    ).length;

    // Re-click the already-active Swing pill. The contract is:
    // same-mode click is a no-op — it MUST NOT clear state (no
    // loader flash) and MUST NOT re-fire the fetch.
    fireEvent.click(screen.getByRole("tab", { name: /^Swing$/i }));

    expect(screen.queryByTestId("signals-setup-loading")).toBeNull();
    expect(screen.getByTestId("signals-setup-bias")).toHaveTextContent("Bullish");

    // Allow any micro-tasks to flush, then re-check fetch count is
    // unchanged. (We don't await waitFor here because the assertion
    // is "no new fetch was fired", and waitFor would mask a delayed
    // fetch instead of catching it.)
    await Promise.resolve();
    const swingFetchCountAfter = fetchMock.mock.calls.filter((c) =>
      String(c[0] ?? "").endsWith("/api/stocvest/signals/composite/swing")
    ).length;
    expect(swingFetchCountAfter).toBe(swingFetchCountBefore);
  });
});

describe("SignalsPageClient — Swing Pro (dayTradingSurfaces=false)", () => {
  test("hides mode tablist and stays on swing even when prefill asked for day", async () => {
    const swingPayload = compositePayload({ summary: "Bullish", fingerprint: "SWING_PRO_FP" });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : String(input);
      if (url.endsWith("/api/stocvest/signals/composite/swing")) {
        return mockCompositeOk(swingPayload);
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    wrap(
      <SignalsPageClient
        marketOverview={EMPTY_MARKET_OVERVIEW}
        scannerOverview={EMPTY_SCANNER_OVERVIEW}
        dayTradingSurfaces={false}
        signalsPrefill={{
          urlSymbol: "AAPL",
          signalIdForResolve: null,
          hadSignalIdQuery: false,
          initialTradingMode: "day"
        }}
      />
    );

    expect(screen.queryByRole("tablist", { name: /Trading mode/i })).toBeNull();
    expect(screen.getByText(/Swing \(your plan\)/)).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByTestId("signals-setup-bias")).toHaveTextContent("Bullish")
    );
  });
});
