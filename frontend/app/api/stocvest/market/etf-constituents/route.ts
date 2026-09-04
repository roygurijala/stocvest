import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/** Proxies GET /v1/market/etf-constituents?symbol=XLE for sector panel top holdings. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const symbol = (u.searchParams.get("symbol") ?? u.searchParams.get("etf") ?? "").trim().toUpperCase();
  if (!symbol) {
    return NextResponse.json(
      { etf: "", source: "unavailable", constituents: [], degraded: true },
      { status: 200 }
    );
  }

  const limit = (u.searchParams.get("limit") ?? "").trim();
  const qs = new URLSearchParams({ symbol });
  if (limit) qs.set("limit", limit);

  try {
    const res = await stocvestAuthedFetch(`/v1/market/etf-constituents?${qs.toString()}`, {
      method: "GET"
    });
    if (res.status >= 500) {
      return NextResponse.json(
        { etf: symbol, source: "unavailable", constituents: [], degraded: true, upstream_status: res.status },
        { status: 200 }
      );
    }
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") || "application/json" }
    });
  } catch {
    return NextResponse.json(
      { etf: symbol, source: "unavailable", constituents: [], degraded: true },
      { status: 200 }
    );
  }
}
