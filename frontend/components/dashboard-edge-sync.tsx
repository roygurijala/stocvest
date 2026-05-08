"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchDashboardData, isStale, type DashboardResponse } from "@/lib/api/dashboard";
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
 */
export function DashboardEdgeSync() {
  const [mode, setMode] = useState<"swing" | "day">("swing");
  const [data, setData] = useState<DashboardResponse | null>(null);

  useEffect(() => {
    setMode(readTradingMode());
    const onStorage = (e: StorageEvent) => {
      if (e.key === MODE_STORAGE) setMode(readTradingMode());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchDashboardData(mode);
      setData(next);
    } catch {
      /* ignore — Upstash optional */
    }
  }, [mode]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  const onHint = useCallback(
    (_expectedVersion: string) => {
      void refresh();
    },
    [refresh]
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
