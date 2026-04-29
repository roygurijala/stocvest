import { apiFetch } from "@/lib/api/client";

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
    const snapshots = await Promise.all(
      cleanSymbols.map((symbol) => apiFetch<SnapshotPayload>(`/v1/market/snapshot?symbol=${symbol}`))
    );
    const news = await apiFetch<NewsPayload[]>("/v1/market/news?limit=5");
    return { status, snapshots, news };
  } catch (error: unknown) {
    return {
      snapshots: [],
      news: [],
      error: error instanceof Error ? error.message : "Unknown market API error."
    };
  }
}
