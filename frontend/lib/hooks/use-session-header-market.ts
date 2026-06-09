"use client";

import { useMemo } from "react";
import type { MarketOverview } from "@/lib/api/market";
import { useDashboardTape } from "@/lib/hooks/use-dashboard-tape";
import { useMacroContext } from "@/lib/hooks/use-macro-context";
import { isRegularSessionOpen } from "@/lib/market/regular-session";
import {
  marketStatusLabelFor,
  resolveSessionRegimeLabel,
  snapPct
} from "@/lib/session-header-market";

const EMPTY_MARKET_OVERVIEW: MarketOverview = { snapshots: [], news: [] };

type Args = {
  scannerSpyPct?: number | null;
  scannerQqqPct?: number | null;
  scannerRegimeLabel?: string | null;
  scannerError?: string | null;
  /** Fallback for "Market data as of" when tape status is unavailable. */
  fallbackUpdatedAtIso?: string | null;
};

export function useSessionHeaderMarket(args: Args = {}) {
  const { data: macro } = useMacroContext();
  const { snapshotsBySymbol, status: marketStatus } = useDashboardTape(EMPTY_MARKET_OVERVIEW);

  const spyPct = args.scannerSpyPct ?? snapPct(snapshotsBySymbol.get("SPY"));
  const qqqPct = args.scannerQqqPct ?? snapPct(snapshotsBySymbol.get("QQQ"));
  const iwmPct = snapPct(snapshotsBySymbol.get("IWM"));

  const regimeLabel = resolveSessionRegimeLabel({
    macroRegime: macro?.market_regime,
    scannerError: args.scannerError,
    scannerRegimeLabel: args.scannerRegimeLabel,
    spyPct: typeof spyPct === "number" ? spyPct : null,
    qqqPct: typeof qqqPct === "number" ? qqqPct : null
  });

  const vixSnap =
    snapshotsBySymbol.get("I:VIX") ?? snapshotsBySymbol.get("^VIX") ?? snapshotsBySymbol.get("VIX");
  const vixLevel =
    typeof vixSnap?.last_trade_price === "number" && Number.isFinite(vixSnap.last_trade_price)
      ? vixSnap.last_trade_price
      : null;

  const marketOpen = marketStatus ? isRegularSessionOpen(marketStatus) : null;
  const marketStatusLabel = marketStatusLabelFor(marketStatus?.market, marketOpen);

  const updatedAtIso = useMemo(
    () => marketStatus?.server_time ?? args.fallbackUpdatedAtIso ?? null,
    [marketStatus?.server_time, args.fallbackUpdatedAtIso]
  );

  return {
    regimeLabel,
    spyPct: typeof spyPct === "number" ? spyPct : null,
    qqqPct: typeof qqqPct === "number" ? qqqPct : null,
    iwmPct: typeof iwmPct === "number" ? iwmPct : null,
    vixLevel,
    marketOpen,
    marketStatusLabel,
    updatedAtIso
  };
}
