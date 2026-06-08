import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";
import { canonicalUsTickerFromSearch } from "@/lib/symbol-ticker";
import { isTickerSearchQueryReady } from "@/lib/ticker-search-query";
import { finalizeTickerSearchItems, type TickerSearchItem } from "@/lib/symbol-typeahead";
import { rankSymbolCandidates } from "@/lib/symbol-suggestion-rank";

/**
 * Rank search hits so the exact ticker match (bucket 0) and prefix
 * matches (bucket 1) always surface before company-name matches,
 * regardless of the order the upstream API returns them.
 */
function rankTickerItems(q: string, items: TickerSearchItem[]): TickerSearchItem[] {
  const ranked = rankSymbolCandidates(
    items.map((i) => ({
      symbol: i.symbol,
      label: i.name ? `${i.symbol} — ${i.name}` : i.symbol
    })),
    q
  );
  const symbolOrder = new Map(ranked.map((r, idx) => [r.symbol, idx]));
  const sorted = [...items].sort((a, b) => {
    const ai = symbolOrder.get(a.symbol) ?? 999;
    const bi = symbolOrder.get(b.symbol) ?? 999;
    return ai - bi;
  });
  return finalizeTickerSearchItems(q, sorted);
}

function mapPolygonResults(data: unknown): { symbol: string; name: string }[] {
  if (!data || typeof data !== "object") return [];
  const results = (data as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const out: { symbol: string; name: string }[] = [];
  for (const row of results) {
    if (!row || typeof row !== "object") continue;
    const t = canonicalUsTickerFromSearch(String((row as { ticker?: unknown }).ticker ?? ""));
    if (!t) continue;
    out.push({
      symbol: t,
      name: String((row as { name?: unknown }).name ?? "").trim()
    });
    if (out.length >= 25) break;
  }
  return out;
}

/** When API Gateway has not shipped GET /v1/market/tickers-search yet, use Polygon from the server. */
async function polygonDirectSearch(q: string): Promise<{ symbol: string; name: string }[]> {
  const key = process.env.POLYGON_API_KEY?.trim();
  if (!key) return [];
  const url = new URL("https://api.polygon.io/v3/reference/tickers");
  url.searchParams.set("search", q);
  url.searchParams.set("active", "true");
  url.searchParams.set("limit", "25");
  url.searchParams.set("market", "stocks");
  url.searchParams.set("apiKey", key);
  const r = await fetch(url.toString(), { cache: "no-store" });
  if (!r.ok) return [];
  const data = await r.json().catch(() => null);
  return mapPolygonResults(data);
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").trim();
  if (!isTickerSearchQueryReady(q)) {
    return NextResponse.json({ items: [] }, { status: 200 });
  }

  try {
    const res = await stocvestAuthedFetch(`/v1/market/tickers-search?q=${encodeURIComponent(q)}`, {
      method: "GET"
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      const raw: TickerSearchItem[] = Array.isArray(data?.items) ? data.items : [];
      return NextResponse.json({ items: rankTickerItems(q, raw) });
    }
  } catch {
    /* fall through to Polygon / soft error */
  }

  const direct = await polygonDirectSearch(q);
  if (direct.length > 0) {
    return NextResponse.json({ items: rankTickerItems(q, direct) });
  }

  return NextResponse.json(
    {
      items: [],
      error:
        "Ticker search is unavailable. Set POLYGON_API_KEY on this host (e.g. Vercel) until GET /v1/market/tickers-search is deployed on API Gateway."
    },
    { status: 200 }
  );
}
