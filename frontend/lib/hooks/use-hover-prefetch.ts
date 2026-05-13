"use client";

/**
 * `useHoverPrefetch(href)` — intent-driven route prefetch.
 *
 * Tier 1 → Layer 4 (see `docs/PERFORMANCE.md` §1 layer 4 + §4C).
 *
 * Returns a small bag of event handlers (`{ onMouseEnter,
 * onFocus, onPointerDown }`) you spread onto any `<Link>` (or any
 * focusable element). When the user hovers, tab-focuses, or
 * touch-taps the element, this hook calls `router.prefetch(href)`
 * to warm Next.js's RSC cache for the target route. By the time
 * the click registers (~100–300ms after hover for desktop, ~50ms
 * after pointer-down for touch) the RSC payload is already in
 * flight or in cache, so the navigation feels instant.
 *
 * This is the OPPOSITE of `<Link prefetch={true}>` (Next.js's
 * mount-time prefetch). That mode caused the "prefetch storm" we
 * killed in Tier 1.A — every visible `<Link>` on the dashboard
 * fired a heavy SSR prefetch on mount, blowing 16s of content-
 * download time. With Tier 1.A we set `prefetch={false}` on every
 * heavy-target dashboard link. With Layer 4 we add this hook to
 * those SAME links so we get the best of both worlds:
 *
 *   * No prefetch on mount (Tier 1.A invariant preserved).
 *   * Intent-driven prefetch on hover / focus / touch-start
 *     (Layer 4: warm cache exactly when the user is about to
 *     navigate).
 *
 * Important invariants (locked in by
 * `tests/use-hover-prefetch.test.tsx`):
 *
 *   * Each `href` is prefetched AT MOST ONCE per hook instance.
 *     The hook holds a ref that flips after the first call so
 *     re-hovering does not re-fire prefetch. (SWR + RSC cache
 *     handle freshness from there.)
 *
 *   * `null` / empty `href` → handlers are no-ops. Lets callers
 *     conditionally enable prefetch without `useHoverPrefetch ?
 *     ... : null` ternaries at every callsite.
 *
 *   * The hook accepts an optional `router` override. The
 *     default is `useRouter()`. Tests pass a fake router to
 *     avoid setting up the full Next.js navigation context.
 */

import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

export interface HoverPrefetchHandlers {
  onMouseEnter: () => void;
  onFocus: () => void;
  onPointerDown: () => void;
}

interface RouterLike {
  prefetch: (href: string) => void;
}

export interface UseHoverPrefetchOptions {
  router?: RouterLike;
  /**
   * Whether the hook is enabled. Defaults to `true`. Pass `false`
   * to disable temporarily (e.g. when an experiment flag is off)
   * without changing call-site shape.
   */
  enabled?: boolean;
}

export function useHoverPrefetch(
  href: string | null | undefined,
  options: UseHoverPrefetchOptions = {}
): HoverPrefetchHandlers {
  const { enabled = true, router: routerOverride } = options;
  // `useRouter()` is safe to call unconditionally at the top
  // level — that's the React rule. The override is for tests.
  const defaultRouter = useRouter();
  const router = routerOverride ?? defaultRouter;

  const firedRef = useRef(false);

  const prefetch = useCallback(() => {
    if (!enabled) return;
    if (!href) return;
    if (firedRef.current) return;
    firedRef.current = true;
    try {
      router.prefetch(href);
    } catch {
      // `router.prefetch` is best-effort. Swallowing here means a
      // transient error (e.g. service worker race) cannot break
      // the parent component.
    }
  }, [enabled, href, router]);

  return {
    onMouseEnter: prefetch,
    onFocus: prefetch,
    onPointerDown: prefetch
  };
}
