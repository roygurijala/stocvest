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
  error?: string;
}

const DEFAULT_SYMBOLS = ["SPY", "QQQ", "IWM"];

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
    return {
      status,
      snapshots: snapshots.filter((s): s is SnapshotPayload => Boolean(s)),
      news: news || []
    };
  } catch (error: unknown) {
    return {
      snapshots: [],
      news: [],
      error: error instanceof Error ? error.message : "Unable to connect. Check your connection."
    };
  }
}
