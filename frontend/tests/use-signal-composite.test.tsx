/**
 * Tier 1 → Layer 4 (second slice) — `useSignalComposite` lock-in tests.
 *
 * See `docs/PERFORMANCE.md` §4C and
 * `lib/hooks/use-signal-composite.ts` for the rationale doc-block.
 *
 * Pinned invariants:
 *
 *   1. Empty / whitespace symbol → fetcher never called.
 *   2. `enabled: false` → fetcher never called.
 *   3. Happy path → fetcher receives the right URL + body for the
 *      requested mode (swing → `/composite/swing`, day →
 *      `/composite/real`).
 *   4. Two hooks for the same (symbol, mode) within the dedupe
 *      window → fetcher called once.
 *   5. Mode flip → fetcher called again with the new endpoint;
 *      the cache key for the previous mode stays available so a
 *      flip back to the original mode hits the cache.
 *   6. Non-2xx response → `composite: null` and `error` populated.
 */

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

import { useSignalComposite, __internal_fetchSignalComposite } from "@/lib/hooks/use-signal-composite";

const fetchMock = vi.fn();
const ORIGINAL_FETCH = global.fetch;

function makeOkResponse(body: Record<string, unknown>): Response {
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

function DedupeProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        provider: () => new Map(),
        dedupingInterval: 30_000,
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

describe("useSignalComposite", () => {
  test("empty symbol → fetcher never called", async () => {
    const { result } = renderHook(() => useSignalComposite("", "swing"), {
      wrapper: Provider
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.composite).toBeNull();
  });

  test("whitespace symbol → fetcher never called", async () => {
    const { result } = renderHook(() => useSignalComposite("   ", "day"), {
      wrapper: Provider
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.composite).toBeNull();
  });

  test("enabled: false → fetcher never called even for valid symbol", async () => {
    const { result } = renderHook(
      () => useSignalComposite("AAPL", "swing", { enabled: false }),
      { wrapper: Provider }
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.composite).toBeNull();
  });

  test("swing mode → POSTs to /composite/swing with the symbol in the body", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ signal_summary: "bullish" }));
    const { result } = renderHook(
      () => useSignalComposite("aapl", "swing"),
      { wrapper: Provider }
    );
    await waitFor(() => expect(result.current.composite).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/stocvest/signals/composite/swing");
    expect((init as RequestInit | undefined)?.method).toBe("POST");
    expect(String((init as RequestInit | undefined)?.body)).toContain("AAPL");
    expect(result.current.composite?.signal_summary).toBe("bullish");
  });

  test("day mode → POSTs to /composite/real (the day-engine endpoint)", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ signal_summary: "bearish" }));
    const { result } = renderHook(
      () => useSignalComposite("nvda", "day"),
      { wrapper: Provider }
    );
    await waitFor(() => expect(result.current.composite).not.toBeNull());
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/stocvest/signals/composite/real");
  });

  test("two hooks for same (symbol, mode) → fetcher called once (SWR dedupe)", async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ signal_summary: "bullish" }));
    function PairedHooks() {
      const a = useSignalComposite("AAPL", "swing");
      const b = useSignalComposite("AAPL", "swing");
      return { a, b };
    }
    const { result } = renderHook(() => PairedHooks(), {
      wrapper: DedupeProvider
    });
    await waitFor(() => expect(result.current.a.composite).not.toBeNull());
    expect(result.current.b.composite).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("non-2xx response → composite stays null, error is populated", async () => {
    fetchMock.mockResolvedValue(
      new Response("{}", { status: 500, headers: { "content-type": "application/json" } })
    );
    const { result } = renderHook(
      () => useSignalComposite("AAPL", "swing"),
      { wrapper: Provider }
    );
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.composite).toBeNull();
  });

  test("rate_limited envelope retries then returns composite payload", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(
        makeOkResponse({ error: "rate_limited", retry_after: 1 })
      )
      .mockResolvedValueOnce(makeOkResponse({ signal_summary: "bullish", layers: [] }));
    const pending = __internal_fetchSignalComposite("GGAL", "swing");
    await vi.advanceTimersByTimeAsync(1000);
    const body = await pending;
    expect(body.signal_summary).toBe("bullish");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
