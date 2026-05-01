import { readWsTokenFromDocumentCookie } from "@/lib/auth/ws-token-cookie";

import type { NewsPayload } from "./market";

const DEFAULT_BASE_URL = "http://localhost:3001";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_STOCVEST_API_BASE_URL || DEFAULT_BASE_URL;
}

/** Polygon-backed articles for a single ticker; safe in Client Components (no `next/headers`). */
export async function fetchSymbolNews(symbol: string, limit = 10): Promise<NewsPayload[]> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) {
    return [];
  }
  const capped = Math.min(100, Math.max(1, limit));
  const token = readWsTokenFromDocumentCookie();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const res = await fetch(
    `${apiBaseUrl()}/v1/market/news?symbol=${encodeURIComponent(sym)}&limit=${capped}`,
    { method: "GET", credentials: "include", headers, cache: "no-store" }
  ).catch(() => null);
  if (!res || !res.ok) {
    return [];
  }
  try {
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as NewsPayload[]) : [];
  } catch {
    return [];
  }
}
