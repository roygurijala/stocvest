/**
 * Tier 1 → Layer 4 — `useSymbolSnapshot` lock-in tests.
 *
 * See `docs/PERFORMANCE.md` §1 layer 4 + §4C and
 * `lib/hooks/use-symbol-snapshot.ts` for the rationale doc-block.
 *
 * Pinned invariants:
 *
 *   1. Empty / whitespace symbol → fetcher never called.
 *   2. Same symbol mounted in two hooks within the dedupe window
 *      → fetcher called exactly once (SWR cache hit).
 *   3. Ticker mismatch (upstream returned a snapshot for a
 *      different symbol — happens on ambiguous queries) → hook
 *      returns `null` rather than misleading data.
 *   4. Successful fetch resolves with the snapshot.
 *
 * Test strategy:
 *
 *   We mock `fetchSymbolSnapshot` directly so we control exactly
 *   what the underlying fetcher returns. SWR's cache is shared
 *   across hooks via React context — by mounting hooks inside a
 *   single `SWRConfig provider` we get realistic dedupe behaviour
 *   without spinning up real network calls.
 */

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

const fetcherMock = vi.fn();
vi.mock("@/lib/api/fetch-symbol-snapshot", () => ({
  fetchSymbolSnapshot: (...args: unknown[]) => fetcherMock(...args)
}));

import { useSymbolSnapshot } from "@/lib/hooks/use-symbol-snapshot";

function Provider({ children }: { children: ReactNode }) {
  // `dedupingInterval: 0` + `provider: () => new Map()` gives each
  // test a fresh cache, which is what we want for isolation. Tests
  // that explicitly assert dedupe override `dedupingInterval`.
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

describe("useSymbolSnapshot", () => {
  test("empty symbol → fetcher never called, snapshot stays null", async () => {
    const { result } = renderHook(() => useSymbolSnapshot(""), {
      wrapper: Provider
    });
    // Give SWR a tick to settle.
    await new Promise((r) => setTimeout(r, 5));
    expect(fetcherMock).not.toHaveBeenCalled();
    expect(result.current.snapshot).toBeNull();
  });

  test("whitespace-only symbol → fetcher never called", async () => {
    const { result } = renderHook(() => useSymbolSnapshot("   "), {
      wrapper: Provider
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(fetcherMock).not.toHaveBeenCalled();
    expect(result.current.snapshot).toBeNull();
  });

  test("happy path → returns the snapshot for the requested symbol", async () => {
    fetcherMock.mockResolvedValue({
      symbol: "AAPL",
      last_price: 195.5,
      timestamp_iso: "2026-05-13T18:00:00Z"
    });
    const { result } = renderHook(() => useSymbolSnapshot("AAPL"), {
      wrapper: Provider
    });
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    expect(result.current.snapshot?.symbol).toBe("AAPL");
    expect(fetcherMock).toHaveBeenCalledTimes(1);
    expect(fetcherMock).toHaveBeenCalledWith("AAPL");
  });

  test("ticker-mismatch guard → upstream returned wrong symbol, hook returns null", async () => {
    // Upstream sometimes resolves ambiguous queries to a different
    // ticker (e.g. asks for "AAPL.X" and gets back "AAPL"). The
    // hook MUST drop the result rather than show stale data
    // under a label the user did not ask for.
    fetcherMock.mockResolvedValue({
      symbol: "MSFT",
      last_price: 400,
      timestamp_iso: "2026-05-13T18:00:00Z"
    });
    const { result } = renderHook(() => useSymbolSnapshot("AAPL"), {
      wrapper: Provider
    });
    await waitFor(() => expect(fetcherMock).toHaveBeenCalled());
    // After the fetcher resolves, the mismatch guard kicks in and
    // returns `null` even though SWR has data in the cache.
    expect(result.current.snapshot).toBeNull();
  });

  test("normalizes case + trims whitespace before fetching", async () => {
    fetcherMock.mockResolvedValue({
      symbol: "NVDA",
      last_price: 100,
      timestamp_iso: "2026-05-13T18:00:00Z"
    });
    const { result } = renderHook(() => useSymbolSnapshot("  nvda  "), {
      wrapper: Provider
    });
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    expect(fetcherMock).toHaveBeenCalledWith("NVDA");
    expect(result.current.snapshot?.symbol).toBe("NVDA");
  });

  test("dedupe window: two hooks for same symbol → fetcher called once", async () => {
    fetcherMock.mockResolvedValue({
      symbol: "AAPL",
      last_price: 195.5,
      timestamp_iso: "2026-05-13T18:00:00Z"
    });
    // Custom wrapper: render both hooks inside ONE shared cache so
    // they participate in the same dedupe interval.
    function PairedHooks() {
      const a = useSymbolSnapshot("AAPL");
      const b = useSymbolSnapshot("AAPL");
      return { a, b };
    }
    const { result } = renderHook(() => PairedHooks(), {
      wrapper: DedupeProvider
    });
    await waitFor(() => expect(result.current.a.snapshot).not.toBeNull());
    expect(result.current.b.snapshot).not.toBeNull();
    // CRITICAL: even though TWO components asked for AAPL, only
    // ONE network call should have fired thanks to SWR dedupe.
    expect(fetcherMock).toHaveBeenCalledTimes(1);
  });
});
