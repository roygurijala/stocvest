import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/**
 * Proxies GET /v1/market/bars?symbol=&timeframe=&limit= for Client Components
 * (session cookie auth). Used by the assistant's expandable full price chart.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const symbol = (u.searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }
  const timeframe = (u.searchParams.get("timeframe") ?? "1day").trim();
  const limitRaw = Number.parseInt(u.searchParams.get("limit") ?? "120", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 120;

  const qs = new URLSearchParams({ symbol, timeframe, limit: String(limit) });

  try {
    const res = await stocvestAuthedFetch(`/v1/market/bars?${qs.toString()}`, { method: "GET" });
    if (res.status >= 500) {
      return NextResponse.json({ bars: [], degraded: true, upstream_status: res.status }, { status: 200 });
    }
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") || "application/json" }
    });
  } catch {
    return NextResponse.json({ bars: [], degraded: true }, { status: 200 });
  }
}
