"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { isStale } from "@/lib/api/dashboard";
import {
  buildClientMarketEnvironmentPolicy,
  parseMarketEnvironmentFromPulse
} from "@/lib/market-environment/policy";
import type { MarketEnvironmentPayload } from "@/lib/signal-evidence/market-environment-present";
import { parseMarketEnvironment } from "@/lib/signal-evidence/market-environment-present";
import { STOCVEST_SWR_CACHE_NS } from "@/lib/swr/config";
import { useDashboardPayload } from "@/lib/hooks/use-dashboard-payload";

const VIX_KEY = `${STOCVEST_SWR_CACHE_NS}desk-vix-fallback` as const;

async function fetchVixFallback(): Promise<{ level: number | null; changePct: number | null }> {
  try {
    const res = await fetch("/api/market/vix-snapshot", { cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as {
      snapshot?: { last_trade_price?: number; change_percent?: number };
    };
    const snap = json.snapshot;
    const level =
      typeof snap?.last_trade_price === "number" && Number.isFinite(snap.last_trade_price)
        ? snap.last_trade_price
        : null;
    const changePct =
      typeof snap?.change_percent === "number" && Number.isFinite(snap.change_percent)
        ? snap.change_percent
        : null;
    return { level, changePct };
  } catch {
    return { level: null, changePct: null };
  }
}

function envFromMorningBrief(
  raw: Record<string, unknown> | null | undefined,
  mode: "day" | "swing"
): MarketEnvironmentPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const key = mode === "day" ? "market_environment_day" : "market_environment_swing";
  const nested =
    (raw.conditions as Record<string, unknown> | undefined)?.[key] ??
    (raw.conditions as Record<string, unknown> | undefined)?.market_environment ??
    raw.market_environment;
  if (nested && typeof nested === "object") {
    return parseMarketEnvironment({ market_environment: nested });
  }
  return null;
}

/**
 * Desk Layer 0 policy for scanner / watchlists (pulse → brief → VIX fallback).
 */
export function useMarketEnvironment(
  mode: "day" | "swing",
  options?: { morningBrief?: Record<string, unknown> | null; macroRegime?: string | null }
) {
  const { data: dashboard } = useDashboardPayload(mode);
  const pulse = dashboard?.market_pulse;
  const pulseRaw =
    pulse && !isStale(pulse) && pulse.data && typeof pulse.data === "object"
      ? (pulse.data as Record<string, unknown>)
      : null;

  const { data: vixFallback } = useSWR(
    pulseRaw?.vix_level != null ? null : VIX_KEY,
    fetchVixFallback,
    { revalidateOnFocus: false, dedupingInterval: 120_000 }
  );

  return useMemo(() => {
    const fromBrief = envFromMorningBrief(options?.morningBrief ?? null, mode);
    if (fromBrief) return fromBrief;

    const fromPulse = parseMarketEnvironmentFromPulse(pulseRaw, mode);
    if (fromPulse) return fromPulse;

    const level = vixFallback?.level ?? null;
    if (level == null) return null;
    return buildClientMarketEnvironmentPolicy({
      mode,
      vixLevel: level,
      vixChangePct: vixFallback?.changePct ?? null,
      macroRegime: options?.macroRegime ?? null
    });
  }, [mode, options?.morningBrief, options?.macroRegime, pulseRaw, vixFallback]);
}
