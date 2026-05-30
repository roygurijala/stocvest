"use client";

import { useCallback, useEffect, useState } from "react";
import {
  consumeWatchlistMaturationBump,
  WATCHLIST_MATURATION_UPDATED_EVENT
} from "@/lib/watchlist-maturation-bump";

/** Bump to refetch maturation-summary after session refresh or composite runs. */
export function useWatchlistMaturationReloadNonce(): [number, () => void] {
  const [nonce, setNonce] = useState(0);
  const bump = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const onUpdated = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => bump(), 400);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && consumeWatchlistMaturationBump()) bump();
    };
    const onFocus = () => {
      if (consumeWatchlistMaturationBump()) bump();
    };
    window.addEventListener(WATCHLIST_MATURATION_UPDATED_EVENT, onUpdated);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      if (debounce) clearTimeout(debounce);
      window.removeEventListener(WATCHLIST_MATURATION_UPDATED_EVENT, onUpdated);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [bump]);

  return [nonce, bump];
}
