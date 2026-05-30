"use client";

import { useEffect, useMemo, useState } from "react";
import { useWatchlistSessionRefresh } from "@/lib/hooks/use-watchlist-session-refresh";
import type { WatchlistMaturationDesk } from "@/lib/watchlist-maturation-session-staleness";
import {
  normalizeWatchlistMaturationBySymbol,
  type WatchlistMaturationRow
} from "@/lib/watchlist-page-utils";
import { notifyWatchlistMaturationUpdated } from "@/lib/watchlist-maturation-bump";

type Props = {
  dayTradingSurfaces: boolean;
};

/**
 * Dashboard: load default-watchlist maturation and refresh stale symbols in the background.
 */
export function WatchlistSessionRefreshOrchestrator({ dayTradingSurfaces }: Props) {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [swingBySymbol, setSwingBySymbol] = useState<Record<string, WatchlistMaturationRow>>({});
  const [dayBySymbol, setDayBySymbol] = useState<Record<string, WatchlistMaturationRow>>({});
  const [ready, setReady] = useState(false);

  const desks = useMemo((): WatchlistMaturationDesk[] => {
    return dayTradingSurfaces ? ["swing", "day"] : ["swing"];
  }, [dayTradingSurfaces]);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    void (async () => {
      try {
        const symRes = await fetch("/api/stocvest/watchlists/default/symbols", {
          cache: "no-store",
          credentials: "same-origin"
        });
        const symJson = (await symRes.json().catch(() => ({}))) as { symbols?: string[] };
        const list = Array.isArray(symJson.symbols)
          ? symJson.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
          : [];
        if (cancelled) return;
        setSymbols(list);
        if (list.length === 0) {
          setSwingBySymbol({});
          setDayBySymbol({});
          setReady(true);
          return;
        }
        const fetches = dayTradingSurfaces
          ? [
              fetch("/api/stocvest/watchlists/maturation-summary?mode=swing", {
                cache: "no-store",
                credentials: "same-origin"
              }),
              fetch("/api/stocvest/watchlists/maturation-summary?mode=day", {
                cache: "no-store",
                credentials: "same-origin"
              })
            ]
          : [
              fetch("/api/stocvest/watchlists/maturation-summary?mode=swing", {
                cache: "no-store",
                credentials: "same-origin"
              })
            ];
        const results = await Promise.all(fetches);
        if (cancelled) return;
        const swingJson = results[0]?.ok ? await results[0].json().catch(() => ({})) : {};
        const dayJson = results[1]?.ok ? await results[1].json().catch(() => ({})) : {};
        setSwingBySymbol(normalizeWatchlistMaturationBySymbol(swingJson));
        setDayBySymbol(dayTradingSurfaces ? normalizeWatchlistMaturationBySymbol(dayJson) : {});
        setReady(true);
      } catch {
        if (!cancelled) {
          setSymbols([]);
          setSwingBySymbol({});
          setDayBySymbol({});
          setReady(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dayTradingSurfaces]);

  useWatchlistSessionRefresh({
    enabled: ready && symbols.length > 0,
    symbols,
    swingBySymbol,
    dayBySymbol,
    desks,
    maturationReady: ready,
    onRefreshed: () => {
      for (const sym of symbols) {
        notifyWatchlistMaturationUpdated(sym, "swing");
        if (dayTradingSurfaces) notifyWatchlistMaturationUpdated(sym, "day");
      }
    }
  });

  return null;
}
