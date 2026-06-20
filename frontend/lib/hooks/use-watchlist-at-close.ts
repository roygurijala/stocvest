/**
 * `useWatchlistAtClose()` — compact closing snapshot of the user's default
 * watchlist for the market brief's weekend / after-hours preparation surface.
 *
 * Deliberately lighter than the Trading Room watchlist rail: just symbol, last
 * price, day change, and a maturation state label. Gated by `enabled` so it does
 * not fetch while the regular session is open (the rail covers that case live).
 */
import { useEffect, useState } from "react";
import type { SnapshotPayload } from "@/lib/api/market";
import {
  formatWatchlistMaturationLabel,
  type WatchlistMaturationRow
} from "@/lib/watchlist-page-utils";
import { parseMaturationSummaryEnvelope } from "@/lib/watchlist/maturation-summary-envelope";

export interface WatchlistAtCloseItem {
  symbol: string;
  price: number | null;
  changePct: number | null;
  stateLabel: string;
}

function cleanNum(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function useWatchlistAtClose(enabled: boolean, mode: "swing" | "day" = "swing"): WatchlistAtCloseItem[] {
  const [items, setItems] = useState<WatchlistAtCloseItem[]>([]);

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [wlRes, matRes] = await Promise.all([
          fetch("/api/stocvest/watchlists/default/symbols", { cache: "no-store" }),
          fetch(`/api/stocvest/watchlists/maturation-summary?mode=${encodeURIComponent(mode)}`, { cache: "no-store" })
        ]);
        if (cancelled) return;
        const wlJson = wlRes.ok ? await wlRes.json().catch(() => ({})) : {};
        const matJson = matRes.ok ? await matRes.json().catch(() => ({})) : {};
        const symbols = Array.isArray((wlJson as { symbols?: unknown }).symbols)
          ? ((wlJson as { symbols: string[] }).symbols || []).map((s) => String(s).trim().toUpperCase()).filter(Boolean)
          : [];
        if (symbols.length === 0) {
          setItems([]);
          return;
        }
        const env = parseMaturationSummaryEnvelope(matJson);
        const chunk = symbols.slice(0, 40);
        const snapRes = await fetch(
          `/api/stocvest/market/snapshots?symbols=${encodeURIComponent(chunk.join(","))}`,
          { cache: "no-store" }
        );
        if (cancelled) return;
        const snapJson = snapRes.ok ? ((await snapRes.json().catch(() => ({}))) as { snapshots?: SnapshotPayload[] }) : {};
        const bySnap = new Map<string, SnapshotPayload>();
        for (const row of Array.isArray(snapJson.snapshots) ? snapJson.snapshots : []) {
          const sym = (row.symbol || "").trim().toUpperCase();
          if (sym) bySnap.set(sym, row);
        }
        // Only render symbols we actually fetched snapshots for (the snapshots BFF is
        // capped to 40/request); mapping the full list left >40 rows with null prices.
        const next: WatchlistAtCloseItem[] = chunk.map((sym) => {
          const snap = bySnap.get(sym);
          const row: WatchlistMaturationRow | undefined = env.bySymbol[sym];
          return {
            symbol: sym,
            price: cleanNum(snap?.last_trade_price) ?? cleanNum(snap?.day_close),
            changePct: cleanNum(snap?.change_percent),
            stateLabel: row ? formatWatchlistMaturationLabel(row) : "Monitoring"
          };
        });
        if (!cancelled) setItems(next);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, mode]);

  return items;
}
