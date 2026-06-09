"use client";

import { useEffect, useState } from "react";

/** Stacks layout into a single column below `maxPx` (default 899 — nav rail breakpoint). */
export function useStackedLayout(maxPx = 899): boolean {
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxPx}px)`);
    const update = () => setStacked(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [maxPx]);
  return stacked;
}
