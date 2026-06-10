"use client";

import { useSyncExternalStore } from "react";

/** Stacks layout into a single column below `maxPx` (default 899 — nav rail breakpoint). */
export function useStackedLayout(maxPx = 899): boolean {
  const query = `(max-width: ${maxPx}px)`;

  return useSyncExternalStore(
    (onStoreChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onStoreChange);
      return () => mq.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(query).matches,
    () => true
  );
}
