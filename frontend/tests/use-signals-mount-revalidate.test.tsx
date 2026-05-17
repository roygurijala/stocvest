/**
 * `useSignalsMountRevalidate` — one forced revalidation per (symbol, mode).
 */

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import useSWR from "swr";
import { SWRConfig } from "swr";

import { useSignalsMountRevalidate } from "@/lib/hooks/use-signals-mount-revalidate";
import { STOCVEST_SWR_CACHE_NS } from "@/lib/swr/config";

const fetchMock = vi.fn();
const ORIGINAL_FETCH = global.fetch;

function Provider({ children }: { children: ReactNode }) {
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

function Harness({ symbol, mode }: { symbol: string; mode: "swing" | "day" }) {
  useSignalsMountRevalidate(symbol, mode, true);
  const key = [`${STOCVEST_SWR_CACHE_NS}signal-composite`, symbol.trim().toUpperCase(), mode] as const;
  useSWR(key, async () => {
    const res = await fetch("/api/stocvest/signals/composite/swing", { method: "POST" });
    if (!res.ok) throw new Error("fail");
    return { generated_at: new Date().toISOString() };
  });
  return null;
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof global.fetch;
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ generated_at: new Date().toISOString() }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  );
});

afterEach(() => {
  cleanup();
  global.fetch = ORIGINAL_FETCH;
});

describe("useSignalsMountRevalidate", () => {
  test("triggers at least one composite fetch on mount", async () => {
    renderHook(() => Harness({ symbol: "AAPL", mode: "swing" }), { wrapper: Provider });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1));
  });

  test("rerender does not schedule another page-level revalidate", async () => {
    const { rerender } = renderHook(() => Harness({ symbol: "AAPL", mode: "swing" }), {
      wrapper: Provider
    });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1));
    await new Promise((r) => setTimeout(r, 10));
    const afterMount = fetchMock.mock.calls.length;
    rerender();
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock.mock.calls.length).toBe(afterMount);
  });
});
