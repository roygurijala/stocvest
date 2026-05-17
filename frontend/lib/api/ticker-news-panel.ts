import { readWsTokenFromDocumentCookie } from "@/lib/auth/ws-token-cookie";
import { surfaceAuthErrorIfAny } from "@/lib/auth/surface-auth-error";

const DEFAULT_BASE_URL = "http://localhost:3001";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_STOCVEST_API_BASE_URL || DEFAULT_BASE_URL;
}

export type TickerNewsSource = "benzinga" | "sec_edgar" | "polygon";

export type TickerNewsSentimentLabel = "bullish" | "bearish" | "neutral";

export interface TickerNewsArticle {
  id: string;
  title: string;
  source: TickerNewsSource;
  source_label: string;
  published_at: string;
  sentiment_score: number;
  sentiment_label: TickerNewsSentimentLabel;
  catalyst_type: string | null;
  url: string | null;
  is_recent: boolean;
  age_label: string;
}

export interface TickerNewsPanelResponse {
  symbol: string;
  has_recent_news: boolean;
  recent_cutoff_hours: number;
  articles: TickerNewsArticle[];
  total_found: number;
  oldest_included: string | null;
}

const CACHE_TTL_MS = 120_000;
const cache = new Map<string, { t: number; data: TickerNewsPanelResponse }>();

function panelCacheKey(symbol: string, recentHours: number): string {
  return `${symbol.trim().toUpperCase()}:${recentHours}`;
}

export function tickerNewsCacheGet(symbol: string, recentHours: number = 8): TickerNewsPanelResponse | null {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return null;
  const row = cache.get(panelCacheKey(sym, recentHours));
  if (!row) return null;
  if (Date.now() - row.t > CACHE_TTL_MS) {
    cache.delete(panelCacheKey(sym, recentHours));
    return null;
  }
  return row.data;
}

export function tickerNewsCacheSet(symbol: string, data: TickerNewsPanelResponse, recentHours: number = 8): void {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return;
  cache.set(panelCacheKey(sym, recentHours), { t: Date.now(), data });
}

/** Clears cache entry (e.g. tests). */
export function tickerNewsCacheClear(symbol?: string, recentHours?: number): void {
  if (symbol) {
    const sym = symbol.trim().toUpperCase();
    if (typeof recentHours === "number") {
      cache.delete(panelCacheKey(sym, recentHours));
      return;
    }
    for (const k of [...cache.keys()]) {
      if (k.startsWith(`${sym}:`)) cache.delete(k);
    }
    return;
  }
  cache.clear();
}

export function tickerNewsTriggerLine(symbol: string, recentHours: number = 8): string {
  const data = tickerNewsCacheGet(symbol, recentHours);
  if (!data || data.total_found === 0) {
    return "📰 View news";
  }
  const n = data.total_found;
  const labels = new Set(data.articles.map((a) => a.sentiment_label));
  const hasBull = labels.has("bullish");
  const hasBear = labels.has("bearish");
  if (hasBull && hasBear) {
    return `📰 ${n} articles · Mixed`;
  }
  const avg =
    data.articles.reduce((acc, a) => acc + a.sentiment_score, 0) / Math.max(1, data.articles.length);
  if (avg > 0.2) {
    return `📰 ${n} articles · Bullish avg ${avg >= 0 ? "+" : ""}${avg.toFixed(2)}`;
  }
  if (avg < -0.2) {
    return `📰 ${n} articles · Bearish avg ${avg.toFixed(2)}`;
  }
  return `📰 ${n} articles · Mixed`;
}

export async function fetchTickerNewsPanel(
  symbol: string,
  opts?: { days?: number; limit?: number; recentHours?: number; newsTradingMode?: "day" | "swing" }
): Promise<TickerNewsPanelResponse | null> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return null;
  const days = Math.min(20, Math.max(1, opts?.days ?? 20));
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 20));
  const defaultRecent = opts?.newsTradingMode === "swing" ? 120 : 8;
  const recentHours = Math.min(168, Math.max(1, opts?.recentHours ?? defaultRecent));
  const token = readWsTokenFromDocumentCookie();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const qs = new URLSearchParams({
    symbol: sym,
    days: String(days),
    limit: String(limit),
    recent_hours: String(recentHours)
  });
  const res = await fetch(`${apiBaseUrl()}/v1/market/news?${qs.toString()}`, {
    method: "GET",
    credentials: "include",
    headers,
    cache: "no-store"
  }).catch(() => null);
  if (!res || !res.ok) {
    void surfaceAuthErrorIfAny(res);
    return null;
  }
  try {
    const data = (await res.json()) as TickerNewsPanelResponse;
    if (!data || typeof data !== "object" || !Array.isArray(data.articles)) {
      return null;
    }
    tickerNewsCacheSet(sym, data, recentHours);
    return data;
  } catch {
    return null;
  }
}
