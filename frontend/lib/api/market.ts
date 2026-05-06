import { apiFetch } from "@/lib/api/client";
import { isNextRedirect } from "@/lib/next-errors";

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
  /** Prior regular-session volume from Polygon `prevDay.v` — ADV proxy for liquidity gates. */
  prev_day_volume?: number | null;
  /** Session VWAP from Polygon `day.vw` when present. */
  day_vwap?: number | null;
  pre_market_price?: number | null;
  /** Issuer name when Polygon includes `name` on the ticker snapshot. */
  company_name?: string | null;
}

/** Primary tab category from API (`/v1/market/news`). */
export type NewsIntelCategory =
  | "general"
  | "earnings"
  | "analyst"
  | "macro"
  | "sector"
  | "merger"
  | "breaking";

export type NewsCatalystCategory =
  | "general"
  | "earnings"
  | "analyst"
  | "ma"
  | "fda"
  | "macro"
  | "sector";

export type NewsCredibilityBand = "elite" | "major" | "trade" | "research" | "pr_wire" | "other";

export interface NewsPayload {
  id?: string;
  article_id: string;
  title: string;
  /** Polygon article summary when present. */
  description?: string | null;
  /** Polygon `image_url` when present. */
  image_url?: string | null;
  source?: string | null;
  publisher?: { name?: string; tier?: number } | null;
  tickers: string[];
  published_utc?: string;
  published_at: string;
  article_url?: string;
  url: string;
  /** Present when backend has run sentiment enrichment (e.g. Claude). */
  sentiment?: string | null;
  sentiment_score?: number | null;
  affected_stocks?: Array<{
    symbol: string;
    impact: "bullish" | "bearish" | "neutral";
    reason: string;
    is_direct: boolean;
    is_watchlist: boolean;
  }>;
  impact_summary?: string | null;
  /** Backend relevance rank (0–100). */
  relevance_score?: number;
  /** Tab category for Market Intelligence filters. */
  category?: NewsIntelCategory;
  catalyst_category?: NewsCatalystCategory;
  credibility?: { label: string; band: NewsCredibilityBand };
  /** True when headline tickers overlap the user default watchlist. */
  matches_watchlist?: boolean;
}

export interface MarketOverview {
  status?: MarketStatusPayload;
  snapshots: SnapshotPayload[];
  news: NewsPayload[];
  /** Last N five-minute closes per symbol (for dashboard sparklines). */
  sparklinesBySymbol?: Record<string, number[]>;
  error?: string;
}

const DEFAULT_SYMBOLS = ["SPY", "QQQ", "IWM"];

export type FetchMarketOverviewOptions = {
  /** Fewer bars = faster Polygon calls; default 20. */
  sparklineBarLimit?: number;
};

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

async function fetchOverviewSnapshots(symbols: string[]): Promise<(SnapshotPayload | null)[]> {
  if (symbols.length === 0) return [];
  if (symbols.length === 1) {
    const row = await apiFetch<SnapshotPayload>(
      `/v1/market/snapshot?symbol=${encodeURIComponent(symbols[0])}`
    );
    return [row];
  }
  const batch = await apiFetch<{ snapshots?: SnapshotPayload[] }>(
    `/v1/market/snapshots?symbols=${encodeURIComponent(symbols.join(","))}`
  );
  if (batch?.snapshots && Array.isArray(batch.snapshots) && batch.snapshots.length > 0) {
    const by = new Map<string, SnapshotPayload>();
    for (const row of batch.snapshots) {
      if (row && typeof row === "object" && row.symbol) {
        by.set(String(row.symbol).trim().toUpperCase(), row);
      }
    }
    return symbols.map((s) => by.get(s) ?? null);
  }
  return Promise.all(
    symbols.map((symbol) =>
      apiFetch<SnapshotPayload>(`/v1/market/snapshot?symbol=${encodeURIComponent(symbol)}`)
    )
  );
}

async function fetchOverviewSparklines(
  symbols: string[],
  sparklineBarLimit: number
): Promise<[string, number[]][]> {
  if (symbols.length === 0) return [];
  const requests = symbols.map((symbol) => ({
    symbol,
    timeframe: "5min",
    limit: sparklineBarLimit
  }));
  const batch = await apiFetch<{ bars_by_symbol?: Record<string, Record<string, unknown>[]> }>(
    "/v1/market/bars-batch",
    { method: "POST", body: JSON.stringify({ requests }) }
  );
  if (batch?.bars_by_symbol && typeof batch.bars_by_symbol === "object") {
    return symbols.map((symbol) => {
      const rows =
        batch.bars_by_symbol![symbol] ?? batch.bars_by_symbol![symbol.toUpperCase()] ?? [];
      const arr = Array.isArray(rows) ? rows : [];
      const closes = arr
        .map((b) => barClose(b))
        .filter((n): n is number => n !== null)
        .slice(-sparklineBarLimit);
      return [symbol, closes] as const;
    });
  }
  return Promise.all(
    symbols.map(async (symbol) => {
      const bars = await apiFetch<Record<string, unknown>[]>(
        `/v1/market/bars?symbol=${encodeURIComponent(symbol)}&timeframe=5min&limit=${sparklineBarLimit}`
      );
      const rows = Array.isArray(bars) ? bars : [];
      const closes = rows
        .map((b) => barClose(b))
        .filter((n): n is number => n !== null)
        .slice(-sparklineBarLimit);
      return [symbol, closes] as const;
    })
  );
}

export async function fetchMarketOverview(
  symbols: string[] = DEFAULT_SYMBOLS,
  options: FetchMarketOverviewOptions = {}
): Promise<MarketOverview> {
  const sparklineBarLimit = options.sparklineBarLimit ?? 20;
  const cleanSymbols = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
  try {
    const [status, newsResp, snapshots] = await Promise.all([
      apiFetch<MarketStatusPayload>("/v1/market/status"),
      apiFetch<NewsPayload[] | { headlines?: NewsPayload[] }>("/v1/market/news?limit=20"),
      fetchOverviewSnapshots(cleanSymbols)
    ]);
    const news = Array.isArray(newsResp) ? newsResp : (newsResp?.headlines ?? []);
    if (!status) {
      return { snapshots: [], news: [], error: "Service temporarily unavailable. Please try again." };
    }
    const sparklinesEntries = await fetchOverviewSparklines(cleanSymbols, sparklineBarLimit);
    return {
      status,
      snapshots: snapshots.filter((s): s is SnapshotPayload => Boolean(s)),
      news: news || [],
      sparklinesBySymbol: Object.fromEntries(sparklinesEntries)
    };
  } catch (error: unknown) {
    if (isNextRedirect(error)) throw error;
    return {
      snapshots: [],
      news: [],
      error: error instanceof Error ? error.message : "Unable to connect. Check your connection."
    };
  }
}
