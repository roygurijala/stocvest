"use client";

import { useCallback, useEffect, useState } from "react";
import { coerceDeskTracking, type WatchlistDeskTracking } from "@/lib/watchlist-symbol-tracking";

export const WATCHLIST_SYMBOLS_CHANGED_EVENT = "stocvest:watchlist-symbols-changed";

export type DefaultWatchlistMeta = {
  watchlistId: string;
  symbols: string[];
  symbolTracking: Record<string, WatchlistDeskTracking>;
};

type CacheEntry = {
  meta: DefaultWatchlistMeta | null;
  loading: boolean;
  error: boolean;
};

let cache: CacheEntry = { meta: null, loading: false, error: false };
const listeners = new Set<() => void>();

function notify() {
  for (const fn of [...listeners]) fn();
}

export function invalidateWatchlistMembershipCache(): void {
  cache = { meta: null, loading: false, error: false };
  notify();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(WATCHLIST_SYMBOLS_CHANGED_EVENT));
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function normalizeSymbols(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const u = String(item ?? "")
      .trim()
      .toUpperCase();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function parseSymbolTracking(raw: unknown, symbols: string[], dualDesk: boolean): Record<string, WatchlistDeskTracking> {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, WatchlistDeskTracking> = {};
  for (const sym of symbols) {
    out[sym] = coerceDeskTracking(src[sym], dualDesk);
  }
  return out;
}

export async function fetchDefaultWatchlistMeta(dualDesk = true): Promise<DefaultWatchlistMeta | null> {
  const listsRes = await fetch("/api/stocvest/watchlists", { credentials: "same-origin", cache: "no-store" });
  if (!listsRes.ok) return null;
  const listsBody = (await listsRes.json().catch(() => ({}))) as {
    watchlists?: Array<{ watchlist_id?: string; is_default?: boolean; symbols?: unknown; symbol_tracking?: unknown }>;
  };
  const rows = listsBody.watchlists ?? [];
  const wl = rows.find((w) => w.is_default) ?? rows[0];
  const watchlistId = String(wl?.watchlist_id ?? "").trim();
  if (!watchlistId) return null;

  const symRes = await fetch("/api/stocvest/watchlists/default/symbols", {
    credentials: "same-origin",
    cache: "no-store"
  });
  let symbols = normalizeSymbols(wl?.symbols);
  let symbolTracking = parseSymbolTracking(wl?.symbol_tracking, symbols, dualDesk);
  if (symRes.ok) {
    const symBody = (await symRes.json().catch(() => ({}))) as {
      symbols?: unknown;
      symbol_tracking?: unknown;
    };
    symbols = normalizeSymbols(symBody.symbols ?? wl?.symbols);
    symbolTracking = parseSymbolTracking(symBody.symbol_tracking ?? wl?.symbol_tracking, symbols, dualDesk);
  }
  return { watchlistId, symbols, symbolTracking };
}

async function ensureWatchlistMetaLoaded(dualDesk: boolean): Promise<void> {
  if (cache.meta || cache.loading) return;
  cache = { ...cache, loading: true, error: false };
  notify();
  try {
    const meta = await fetchDefaultWatchlistMeta(dualDesk);
    cache = { meta, loading: false, error: meta === null };
  } catch {
    cache = { meta: null, loading: false, error: true };
  }
  notify();
}

export function useDefaultWatchlistMembership(symbol: string, dualDeskTracking = true) {
  const symU = symbol.trim().toUpperCase();
  const [, bump] = useState(0);

  useEffect(() => {
    void ensureWatchlistMetaLoaded(dualDeskTracking);
  }, [dualDeskTracking]);
  useEffect(() => subscribe(() => bump((n) => n + 1)), []);

  const refresh = useCallback(async () => {
    invalidateWatchlistMembershipCache();
    cache = { meta: null, loading: false, error: false };
    await ensureWatchlistMetaLoaded(dualDeskTracking);
  }, [dualDeskTracking]);

  const meta = cache.meta;
  const isOnList = Boolean(symU && meta?.symbols.includes(symU));
  const trackingForSymbol = symU && meta ? meta.symbolTracking[symU] : undefined;

  return {
    symU,
    isOnList,
    watchlistId: meta?.watchlistId ?? null,
    symbols: meta?.symbols ?? [],
    trackingForSymbol,
    loading: cache.loading && !meta,
    error: cache.error,
    refresh
  };
}
