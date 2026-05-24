import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";
import { canonicalUsTickerFromSearch } from "@/lib/symbol-ticker";
import { isTickerSearchQueryReady } from "@/lib/ticker-search-query";
import { finalizeTickerSearchItems } from "@/lib/symbol-typeahead";

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
      const text = await res.text();
      return new Response(text, {
        status: 200,
        headers: { "content-type": res.headers.get("content-type") || "application/json" }
      });
    }
  } catch {
    /* fall through to Polygon / soft error */
  }

  const direct = await polygonDirectSearch(q);
  if (direct.length > 0) {
    return NextResponse.json({ items: finalizeTickerSearchItems(q, direct) });
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
