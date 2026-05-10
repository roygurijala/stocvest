import { readWsTokenFromDocumentCookie } from "@/lib/auth/ws-token-cookie";
import { surfaceAuthErrorIfAny } from "@/lib/auth/surface-auth-error";

const DEFAULT_BASE_URL = "http://localhost:3001";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_STOCVEST_API_BASE_URL || DEFAULT_BASE_URL;
}

export interface MinuteBarPayload {
  timestamp: string;
  high: number;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Client-side GET /v1/market/bars (1min) for pre-market / intraday enrichment. */
export async function fetchSymbolMinuteBars(
  symbol: string,
  from: string,
  to: string,
  limit = 500
): Promise<MinuteBarPayload[]> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return [];
  const token = readWsTokenFromDocumentCookie();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const q = new URLSearchParams({
    symbol: sym,
    timeframe: "1min",
    limit: String(limit),
    from,
    to
  });
  try {
    const res = await fetch(`${apiBaseUrl()}/v1/market/bars?${q}`, {
      method: "GET",
      credentials: "include",
      headers,
      cache: "no-store"
    });
    if (!res.ok) {
      surfaceAuthErrorIfAny(res);
      return [];
    }
    const rows = (await res.json()) as Record<string, unknown>[];
    if (!Array.isArray(rows)) return [];
    const out: MinuteBarPayload[] = [];
    for (const r of rows) {
      const ts = r.timestamp;
      if (typeof ts !== "string") continue;
      const hi = num(r.high ?? r.h);
      if (hi == null) continue;
      out.push({ timestamp: ts, high: hi });
    }
    return out;
  } catch {
    return [];
  }
}
