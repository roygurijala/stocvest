import { NextResponse } from "next/server";
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
    if (out.length >= 12) break;
  }
  return out;
}

async function polygonDirectSearch(q: string): Promise<{ symbol: string; name: string }[]> {
  const key = process.env.POLYGON_API_KEY?.trim();
  if (!key) return [];
  const url = new URL("https://api.polygon.io/v3/reference/tickers");
  url.searchParams.set("search", q);
  url.searchParams.set("active", "true");
  url.searchParams.set("limit", "12");
  url.searchParams.set("market", "stocks");
  url.searchParams.set("apiKey", key);
  const r = await fetch(url.toString(), { cache: "no-store" });
  if (!r.ok) return [];
  const data = await r.json().catch(() => null);
  return mapPolygonResults(data);
}

/** Public ticker autocomplete for marketing homepage (no auth). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").trim();
  if (!isTickerSearchQueryReady(q)) {
    return NextResponse.json({ items: [] }, { status: 200 });
  }
  const items = finalizeTickerSearchItems(q, await polygonDirectSearch(q));
  return NextResponse.json({ items });
}
