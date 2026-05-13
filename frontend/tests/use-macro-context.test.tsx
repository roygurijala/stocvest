/**
 * Tier 1 → Layer 4 (second slice) — `useMacroContext` lock-in tests.
 *
 * See `docs/PERFORMANCE.md` §4C and
 * `lib/hooks/use-macro-context.ts` for the rationale doc-block.
 *
 * Pinned invariants:
 *
 *   1. Happy path → fetcher called once, payload returned.
 *   2. Two hooks mounted simultaneously → fetcher called once
 *      (SWR dedupe within the cache window). This is the load-
 *      bearing perf invariant for the macro endpoint: it's
 *      user-agnostic and we explicitly DO NOT include a user id
 *      in the key (cross-cutting invariant #2 in
 *      `docs/PERFORMANCE.md`), so any future call site that adds
 *      a `useMacroContext()` hook contributes ZERO extra network
 *      cost within `dedupingInterval`.
 *   3. Fetcher returns null (existing back-compat for
 *      `fetchMacroContext`'s swallowed errors) → hook's `data`
 *      reflects that null.
 *   4. Fetcher throws → `data: null` and `error` populated.
 *   5. `macroContextKey` is a stable, namespaced tuple.
 */

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

const fetcherMock = vi.fn();
vi.mock("@/lib/api/fetch-macro-context", () => ({
  fetchMacroContext: (...args: unknown[]) => fetcherMock(...args)
}));

import { macroContextKey, useMacroContext } from "@/lib/hooks/use-macro-context";

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

const SAMPLE = {
  upcoming_events: [],
  warnings: [],
  macro_risk: "low",
  macro_risk_level: "1",
  yield_curve: null
};

describe("useMacroContext", () => {
  test("happy path → fetcher called once, payload returned", async () => {
    fetcherMock.mockResolvedValue(SAMPLE);
    const { result } = renderHook(() => useMacroContext(), {
      wrapper: Provider
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(fetcherMock).toHaveBeenCalledTimes(1);
    expect(result.current.data?.macro_risk).toBe("low");
  });

  test("two hooks mounted at once → fetcher called once (SWR dedupe)", async () => {
    fetcherMock.mockResolvedValue(SAMPLE);
    function PairedHooks() {
      const a = useMacroContext();
      const b = useMacroContext();
      return { a, b };
    }
    const { result } = renderHook(() => PairedHooks(), {
      wrapper: DedupeProvider
    });
    await waitFor(() => expect(result.current.a.data).not.toBeNull());
    expect(result.current.b.data).not.toBeNull();
    expect(fetcherMock).toHaveBeenCalledTimes(1);
  });

  test("fetcher returns null → data stays null (back-compat with existing fetchMacroContext)", async () => {
    fetcherMock.mockResolvedValue(null);
    const { result } = renderHook(() => useMacroContext(), {
      wrapper: Provider
    });
    // Give SWR a tick to settle.
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.data).toBeNull();
  });

  test("fetcher throws → data: null, error populated", async () => {
    fetcherMock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useMacroContext(), {
      wrapper: Provider
    });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data).toBeNull();
  });

  test("macroContextKey is namespaced and stable across calls", () => {
    const a = macroContextKey();
    const b = macroContextKey();
    expect(a).toHaveLength(1);
    expect(a[0]).toBe(b[0]);
    expect(String(a[0])).toMatch(/^stocvest:macro-context$/);
  });
});
