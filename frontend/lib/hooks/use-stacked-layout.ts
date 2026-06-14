"use client";

import { useEffect, useState } from "react";
import { NAV_COMPACT_MAX_PX, PAGE_STACK_MAX_PX } from "@/lib/layout-breakpoints";

export { NAV_COMPACT_MAX_PX, PAGE_STACK_MAX_PX };

/**
 * Stacks layout into a single column below `maxPx` (default 899 — nav rail breakpoint).
 *
 * Returns `false` on the server and on the first client paint so SSR markup matches
 * hydration; flips to the real viewport match after mount (avoids hydration errors).
 */
export function useStackedLayout(maxPx = NAV_COMPACT_MAX_PX): boolean {
  const [stacked, setStacked] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const query = `(max-width: ${maxPx}px)`;
    const mq = window.matchMedia(query);
    const update = () => setStacked(mq.matches);
    update();
    setReady(true);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [maxPx]);

  return ready && stacked;
}
