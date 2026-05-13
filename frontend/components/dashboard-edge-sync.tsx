"use client";

import { useCallback, useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import { isStale } from "@/lib/api/dashboard";
import {
  dashboardPayloadKey,
  useDashboardPayload
} from "@/lib/hooks/use-dashboard-payload";
import { useLiveSignals } from "@/lib/live-signals";

const MODE_STORAGE = "stocvest_trading_mode";

function readTradingMode(): "swing" | "day" {
  if (typeof window === "undefined") return "swing";
  try {
    const v = localStorage.getItem(MODE_STORAGE);
    return v === "day" ? "day" : "swing";
  } catch {
    return "swing";
  }
}

/**
 * Best-effort Edge cache sync: polls /api/dashboard, subscribes to live hints for day mode.
 * Does not replace RSC scanner payload — observability + future hydration hook.
 *
 * Layer 4 (second slice): the previous version managed its own
 * `setInterval(refresh, 60_000)` and local `useState` for the
 * payload. Both are now delegated to SWR via
 * `useDashboardPayload(mode)` — same 60s cadence, but the cache
 * is shared across any future surface that wants to read the
 * Edge envelope, and the SSE hint handler triggers a refresh by
 * calling `mutate(dashboardPayloadKey(mode))` instead of running
 * a parallel `refresh()` closure. The local-mode-state +
 * `storage` event listener stay — SWR is read-only as far as
 * the user's mode pill is concerned.
 */
export function DashboardEdgeSync() {
  const [mode, setMode] = useState<"swing" | "day">("swing");
  const { mutate } = useSWRConfig();

  useEffect(() => {
    setMode(readTradingMode());
    const onStorage = (e: StorageEvent) => {
      if (e.key === MODE_STORAGE) setMode(readTradingMode());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const { data } = useDashboardPayload(mode);

  const onHint = useCallback(
    (_expectedVersion: string) => {
      // Force SWR to re-fetch the current mode's cache entry on a
      // version hint. We deliberately do NOT `await` — the hint
      // handler is fire-and-forget; the polling interval is the
      // safety net.
      void mutate(dashboardPayloadKey(mode));
    },
    [mode, mutate]
  );

  useLiveSignals(mode, onHint);

  const swingEnv = data?.swing_signals;
  const pulse = data?.market_pulse;
  const pulseStale =
    data?.source === "edge_cache" && pulse != null && isStale(pulse);
  const dev = process.env.NODE_ENV !== "production";

  if (data?.source === "edge_cache_unconfigured" && !dev) {
    return null;
  }

  if (!dev && !pulseStale) {
    return null;
  }

  return (
    <div
      className="pointer-events-none fixed bottom-2 right-2 z-[5] max-w-[min(100vw-1rem,20rem)] text-left font-mono text-[10px] leading-snug"
      style={{ color: "rgba(148,163,184,0.45)" }}
    >
      {dev && swingEnv?.state_version ? <div>edge: {swingEnv.state_version}</div> : null}
      {pulseStale ? (
        <div className="text-amber-500/80" style={{ color: "rgba(245,158,11,0.75)" }}>
          Refreshing cache…
        </div>
      ) : null}
    </div>
  );
}
