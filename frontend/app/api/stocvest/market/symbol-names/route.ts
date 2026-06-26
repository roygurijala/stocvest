import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

const MAX_SYMBOLS = 60;
const POLYGON_CONCURRENCY = 8;

function parseSymbols(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const sym = part.trim().toUpperCase();
    if (!sym || seen.has(sym)) continue;
    const core = sym.replace(/\./g, "");
    if (sym.length < 1 || sym.length > 12 || !/^[A-Z]+$/.test(core)) continue;
    seen.add(sym);
    out.push(sym);
    if (out.length >= MAX_SYMBOLS) break;
  }
  return out;
}

async function polygonTickerName(symbol: string, apiKey: string): Promise<string | null> {
  const url = new URL(`https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(symbol)}`);
  url.searchParams.set("apiKey", apiKey);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { results?: { name?: unknown } } | null;
  const name = String(data?.results?.name ?? "").trim();
  return name || null;
}

/** When API Gateway has not shipped GET /v1/market/symbol-names yet, resolve via Polygon. */
async function polygonDirectNames(symbols: string[]): Promise<Record<string, string>> {
  const key = process.env.POLYGON_API_KEY?.trim();
  if (!key || symbols.length === 0) return {};
  const names: Record<string, string> = {};
  for (let i = 0; i < symbols.length; i += POLYGON_CONCURRENCY) {
    const chunk = symbols.slice(i, i + POLYGON_CONCURRENCY);
    await Promise.all(
      chunk.map(async (sym) => {
        const nm = await polygonTickerName(sym, key);
        if (nm) names[sym] = nm;
      })
    );
  }
  return names;
}

/**
 * GET /api/stocvest/market/symbol-names?symbols=AAPL,MSFT
 * Proxies to the backend ticker-name resolver. Company names are decorative, so
 * any failure degrades to Polygon direct lookup (when POLYGON_API_KEY is set).
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const symbols = parseSymbols(u.searchParams.get("symbols") ?? "");
  if (symbols.length === 0) {
    return NextResponse.json({ names: {} }, { status: 200 });
  }

  let names: Record<string, string> = {};

  try {
    const res = await stocvestAuthedFetch(
      `/v1/market/symbol-names?symbols=${encodeURIComponent(symbols.join(","))}`,
      { method: "GET" }
    );
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { names?: Record<string, string> };
      names = data.names ?? {};
    }
  } catch {
    /* fall through to Polygon */
  }

  const missing = symbols.filter((sym) => !names[sym]?.trim());
  if (missing.length > 0) {
    const direct = await polygonDirectNames(missing);
    names = { ...names, ...direct };
  }

  // Mark degraded whenever nothing resolved — including a 200-with-empty upstream,
  // which happens when the backend's own Polygon reference lookup fails or rate-limits.
  // The client treats `degraded` as "retry later" rather than caching empties forever
  // (which would make company names silently vanish until a full page reload).
  if (Object.keys(names).length === 0) {
    return NextResponse.json({ names: {}, degraded: true }, { status: 200 });
  }

  return NextResponse.json({ names }, { status: 200 });
}
