/**
 * Tier 1 → Layer 4 (second slice) — `useSymbolNews` lock-in tests.
 *
 * See `docs/PERFORMANCE.md` §4C and
 * `lib/hooks/use-symbol-news.ts` for the rationale doc-block.
 *
 * Pinned invariants:
 *
 *   1. Empty / whitespace symbol → fetcher never called.
 *   2. `enabled: false` → fetcher never called (gates the
 *      signals-page after-hours panel).
 *   3. Happy path → fetcher receives the right (symbol, limit,
 *      newsTradingMode) tuple.
 *   4. Dedupe: two hooks for the same (symbol, limit, mode) →
 *      fetcher called once.
 *   5. Different `limit` or `mode` produces a different cache
 *      key → fetcher called again.
 *   6. Fetcher error → hook returns `articles: []` so the panel
 *      never shows a dangling spinner.
 */

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

const fetcherMock = vi.fn();
vi.mock("@/lib/api/fetch-symbol-news", () => ({
  fetchSymbolNews: (...args: unknown[]) => fetcherMock(...args)
}));

import { useSymbolNews } from "@/lib/hooks/use-symbol-news";

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
  fetcherMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("useSymbolNews", () => {
  test("empty symbol → fetcher never called, articles is []", async () => {
    const { result } = renderHook(() => useSymbolNews(""), {
      wrapper: Provider
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(fetcherMock).not.toHaveBeenCalled();
    expect(result.current.articles).toEqual([]);
  });

  test("enabled: false → fetcher never called even for valid symbol", async () => {
    const { result } = renderHook(
      () => useSymbolNews("AAPL", { enabled: false }),
      { wrapper: Provider }
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(fetcherMock).not.toHaveBeenCalled();
    expect(result.current.articles).toEqual([]);
  });

  test("happy path → fetcher receives uppercase symbol + limit + mode", async () => {
    fetcherMock.mockResolvedValue([
      { headline: "Test", url: "https://x", source: "Polygon" }
    ]);
    const { result } = renderHook(
      () => useSymbolNews("aapl", { limit: 5, mode: "day" }),
      { wrapper: Provider }
    );
    await waitFor(() => expect(result.current.articles.length).toBeGreaterThan(0));
    expect(fetcherMock).toHaveBeenCalledTimes(1);
    expect(fetcherMock).toHaveBeenCalledWith("AAPL", 5, { newsTradingMode: "day" });
  });

  test("two hooks with same key → fetcher called once (SWR dedupe)", async () => {
    fetcherMock.mockResolvedValue([{ headline: "Test", url: "https://x", source: "Polygon" }]);
    function PairedHooks() {
      const a = useSymbolNews("AAPL", { limit: 5, mode: "day" });
      const b = useSymbolNews("AAPL", { limit: 5, mode: "day" });
      return { a, b };
    }
    const { result } = renderHook(() => PairedHooks(), {
      wrapper: DedupeProvider
    });
    await waitFor(() => expect(result.current.a.articles.length).toBeGreaterThan(0));
    expect(result.current.b.articles.length).toBeGreaterThan(0);
    expect(fetcherMock).toHaveBeenCalledTimes(1);
  });

  test("different mode → different cache key, fetcher called again", async () => {
    fetcherMock.mockResolvedValue([{ headline: "Test", url: "https://x", source: "Polygon" }]);
    function PairedHooks() {
      const a = useSymbolNews("AAPL", { limit: 5, mode: "day" });
      const b = useSymbolNews("AAPL", { limit: 5, mode: "swing" });
      return { a, b };
    }
    const { result } = renderHook(() => PairedHooks(), {
      wrapper: DedupeProvider
    });
    await waitFor(() => expect(result.current.a.articles.length).toBeGreaterThan(0));
    await waitFor(() => expect(result.current.b.articles.length).toBeGreaterThan(0));
    expect(fetcherMock).toHaveBeenCalledTimes(2);
    expect(fetcherMock).toHaveBeenNthCalledWith(1, "AAPL", 5, { newsTradingMode: "day" });
    expect(fetcherMock).toHaveBeenNthCalledWith(2, "AAPL", 5, { newsTradingMode: "swing" });
  });

  test("fetcher rejects → articles collapses to []", async () => {
    fetcherMock.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useSymbolNews("AAPL"), {
      wrapper: Provider
    });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.articles).toEqual([]);
  });
});
