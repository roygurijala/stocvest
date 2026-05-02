import { apiFetch } from "@/lib/api/client";

/** Symbol-scoped news for Client Components lives in `./fetch-symbol-news` (this file’s `apiFetch` pulls server-only auth). */

export interface MarketStatusPayload {
  market: string;
  server_time?: string | null;
  exchanges: Record<string, string>;
  currencies: Record<string, string>;
}

export interface SnapshotPayload {
  symbol: string;
  last_trade_price?: number | null;
  prev_close?: number | null;
  day_open?: number | null;
  day_high?: number | null;
  day_low?: number | null;
  day_volume?: number | null;
  /** Session VWAP from Polygon `day.vw` when present. */
  day_vwap?: number | null;
}

export interface NewsPayload {
  article_id: string;
  title: string;
  source?: string | null;
  tickers: string[];
  published_at: string;
  url: string;
  /** Present when backend has run sentiment enrichment (e.g. Claude). */
  sentiment?: string | null;
  sentiment_score?: number | null;
}

export interface MarketOverview {
  status?: MarketStatusPayload;
  snapshots: SnapshotPayload[];
  news: NewsPayload[];
  /** Last 20 five-minute closes per symbol (for dashboard sparklines). */
  sparklinesBySymbol?: Record<string, number[]>;
  error?: string;
}

const DEFAULT_SYMBOLS = ["SPY", "QQQ", "IWM"];

function barClose(bar: Record<string, unknown>): number | null {
  const c = bar.close ?? bar.c;
  if (typeof c === "number" && Number.isFinite(c)) {
    return c;
  }
  if (typeof c === "string") {
    const n = Number.parseFloat(c);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Single-ticker snapshot for symbols not included in the dashboard overview (SPY/QQQ/IWM). */
export async function fetchSymbolSnapshot(symbol: string): Promise<SnapshotPayload | null> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) {
    return null;
  }
  try {
    const row = await apiFetch<SnapshotPayload>(`/v1/market/snapshot?symbol=${encodeURIComponent(sym)}`);
    return row ?? null;
  } catch {
    return null;
  }
}

export async function fetchMarketOverview(symbols: string[] = DEFAULT_SYMBOLS): Promise<MarketOverview> {
  const cleanSymbols = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
  try {
    const status = await apiFetch<MarketStatusPayload>("/v1/market/status");
    if (!status) {
      return { snapshots: [], news: [], error: "Service temporarily unavailable. Please try again." };
    }
    const snapshots = await Promise.all(
      cleanSymbols.map((symbol) => apiFetch<SnapshotPayload>(`/v1/market/snapshot?symbol=${symbol}`))
    );
    const news = await apiFetch<NewsPayload[]>("/v1/market/news?limit=5");
    const sparklinesEntries = await Promise.all(
      cleanSymbols.map(async (symbol) => {
        const bars = await apiFetch<Record<string, unknown>[]>(
          `/v1/market/bars?symbol=${encodeURIComponent(symbol)}&timeframe=5min&limit=20`
        );
        const rows = Array.isArray(bars) ? bars : [];
        const closes = rows
          .map((b) => barClose(b))
          .filter((n): n is number => n !== null)
          .slice(-20);
        return [symbol, closes] as const;
      })
    );
    return {
      status,
      snapshots: snapshots.filter((s): s is SnapshotPayload => Boolean(s)),
      news: news || [],
      sparklinesBySymbol: Object.fromEntries(sparklinesEntries)
    };
  } catch (error: unknown) {
    return {
      snapshots: [],
      news: [],
      error: error instanceof Error ? error.message : "Unable to connect. Check your connection."
    };
  }
}
