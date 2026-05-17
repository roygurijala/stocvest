/**
 * `useGapIntel` lock-in tests — symbol/mode keyed gap intel for Signals.
 */

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

import type { GapIntelSnapshot } from "@/lib/api/gap-intel";
import { useGapIntel } from "@/lib/hooks/use-gap-intel";

const fetchMock = vi.fn();
const ORIGINAL_FETCH = global.fetch;

const gapIntelFixture: GapIntelSnapshot = {
  symbol: "AAPL",
  session_date: "2026-05-14",
  computed_at_utc: "2026-05-14T12:00:00Z",
  phase: {
    state: "SESSION",
    label: "Regular session",
    window_start_et: "2026-05-14T09:30:00-04:00",
    window_end_et: "2026-05-14T16:00:00-04:00",
    cadence_seconds: 60
  },
  gap: {
    direction: "UP",
    status: "open",
    resolution_state: "unresolved",
    gap_size_pct: 1.2
  },
  levels: {
    fill_level: 100,
    fill_source: "prior_close",
    fill_reliability: "high"
  },
  liquidity: { is_high_liquidity: true, detail: { adv_usd: 1e9 } },
  scenario_builder: { state: "ENABLED", reasons: [] },
  flags: {
    calendar_state: "open",
    stale: false,
    market_closed: false
  }
};

function makeGapSnapshot(symbol: string): GapIntelSnapshot {
  return { ...gapIntelFixture, symbol };
}

function makeOkResponse(body: GapIntelSnapshot): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function Provider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        provider: () => new Map(),
        dedupingInterval: 0,
        shouldRetryOnError: false
      }}
    >
      {children}
    </SWRConfig>
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof global.fetch;
});

afterEach(() => {
  cleanup();
  global.fetch = ORIGINAL_FETCH;
});

describe("useGapIntel", () => {
  test("empty symbol → fetcher never called", async () => {
    const { result } = renderHook(() => useGapIntel("", "swing"), {
      wrapper: Provider
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.snapshot).toBeNull();
  });

  test("happy path → returns snapshot for requested symbol", async () => {
    fetchMock.mockResolvedValue(makeOkResponse(makeGapSnapshot("INTC")));
    const { result } = renderHook(() => useGapIntel("intc", "day"), {
      wrapper: Provider
    });
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    expect(result.current.snapshot?.symbol).toBe("INTC");
    expect(String(fetchMock.mock.calls[0][0])).toContain("symbol=INTC");
  });

  test("ticker-mismatch guard → upstream wrong symbol returns null", async () => {
    fetchMock.mockResolvedValue(makeOkResponse(makeGapSnapshot("MSFT")));
    const { result } = renderHook(() => useGapIntel("AAPL", "swing"), {
      wrapper: Provider
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.snapshot).toBeNull();
  });

  test("symbol change → does not keep previous symbol snapshot", async () => {
    fetchMock
      .mockResolvedValueOnce(makeOkResponse(makeGapSnapshot("AAPL")))
      .mockResolvedValueOnce(makeOkResponse(makeGapSnapshot("NVDA")));

    const { result, rerender } = renderHook(
      ({ sym }: { sym: string }) => useGapIntel(sym, "swing"),
      {
        wrapper: Provider,
        initialProps: { sym: "AAPL" }
      }
    );
    await waitFor(() => expect(result.current.snapshot?.symbol).toBe("AAPL"));

    rerender({ sym: "NVDA" });
    expect(result.current.snapshot).toBeNull();

    await waitFor(() => expect(result.current.snapshot?.symbol).toBe("NVDA"));
  });
});
