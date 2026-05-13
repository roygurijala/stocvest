/**
 * Tier 1 → Layer 4 — `useHoverPrefetch` lock-in tests.
 *
 * See `docs/PERFORMANCE.md` §1 layer 4 + §4C and
 * `lib/hooks/use-hover-prefetch.ts` for the rationale doc-block.
 *
 * Pinned invariants:
 *
 *   1. `onMouseEnter` calls `router.prefetch(href)` exactly once.
 *   2. Subsequent `onMouseEnter` / `onFocus` / `onPointerDown`
 *      calls are no-ops (we don't re-prefetch on every re-hover).
 *   3. `onFocus` and `onPointerDown` are equivalent triggers —
 *      a keyboard tab-focus is just as much "intent" as a hover.
 *   4. `href === null | undefined | ""` → handlers are no-ops.
 *   5. `enabled: false` → handlers are no-ops.
 *   6. `router.prefetch` throwing is swallowed (best-effort).
 *
 * These together encode the contract that the hook is intent-
 * driven, never speculative, and never aggressive.
 */

import { describe, expect, test, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    prefetch: vi.fn()
  })
}));

function makeFakeRouter() {
  return {
    prefetch: vi.fn()
  };
}

describe("useHoverPrefetch", () => {
  test("fires router.prefetch on the first onMouseEnter", () => {
    const router = makeFakeRouter();
    const { result } = renderHook(() =>
      useHoverPrefetch("/dashboard/signals?symbol=AAPL", { router })
    );
    act(() => {
      result.current.onMouseEnter();
    });
    expect(router.prefetch).toHaveBeenCalledTimes(1);
    expect(router.prefetch).toHaveBeenCalledWith(
      "/dashboard/signals?symbol=AAPL"
    );
  });

  test("re-hovering does not re-fire prefetch", () => {
    const router = makeFakeRouter();
    const { result } = renderHook(() =>
      useHoverPrefetch("/dashboard/scanner?mode=swing", { router })
    );
    act(() => {
      result.current.onMouseEnter();
      result.current.onMouseEnter();
      result.current.onMouseEnter();
    });
    expect(router.prefetch).toHaveBeenCalledTimes(1);
  });

  test("onFocus and onPointerDown are equivalent intent triggers", () => {
    const router = makeFakeRouter();
    const { result } = renderHook(() =>
      useHoverPrefetch("/dashboard/signals", { router })
    );
    act(() => {
      result.current.onFocus();
    });
    expect(router.prefetch).toHaveBeenCalledTimes(1);

    const router2 = makeFakeRouter();
    const { result: result2 } = renderHook(() =>
      useHoverPrefetch("/dashboard/signals", { router: router2 })
    );
    act(() => {
      result2.current.onPointerDown();
    });
    expect(router2.prefetch).toHaveBeenCalledTimes(1);
  });

  test("null / empty / undefined href → no prefetch", () => {
    const routerNull = makeFakeRouter();
    const { result: rNull } = renderHook(() =>
      useHoverPrefetch(null, { router: routerNull })
    );
    act(() => {
      rNull.current.onMouseEnter();
    });
    expect(routerNull.prefetch).not.toHaveBeenCalled();

    const routerEmpty = makeFakeRouter();
    const { result: rEmpty } = renderHook(() =>
      useHoverPrefetch("", { router: routerEmpty })
    );
    act(() => {
      rEmpty.current.onMouseEnter();
    });
    expect(routerEmpty.prefetch).not.toHaveBeenCalled();

    const routerUndef = makeFakeRouter();
    const { result: rUndef } = renderHook(() =>
      useHoverPrefetch(undefined, { router: routerUndef })
    );
    act(() => {
      rUndef.current.onMouseEnter();
    });
    expect(routerUndef.prefetch).not.toHaveBeenCalled();
  });

  test("enabled: false disables all triggers", () => {
    const router = makeFakeRouter();
    const { result } = renderHook(() =>
      useHoverPrefetch("/dashboard/signals", {
        router,
        enabled: false
      })
    );
    act(() => {
      result.current.onMouseEnter();
      result.current.onFocus();
      result.current.onPointerDown();
    });
    expect(router.prefetch).not.toHaveBeenCalled();
  });

  test("swallows errors thrown by router.prefetch", () => {
    const router = {
      prefetch: vi.fn(() => {
        throw new Error("boom");
      })
    };
    const { result } = renderHook(() =>
      useHoverPrefetch("/dashboard/signals", { router })
    );
    expect(() =>
      act(() => {
        result.current.onMouseEnter();
      })
    ).not.toThrow();
    expect(router.prefetch).toHaveBeenCalledTimes(1);
  });
});
