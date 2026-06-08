import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/** Proxies GET /v1/market/snapshot?symbol= for Client Components. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const symbol = (u.searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }
  try {
    const res = await stocvestAuthedFetch(`/v1/market/snapshot?symbol=${encodeURIComponent(symbol)}`, {
      method: "GET"
    });
    if (res.status >= 500) {
      return NextResponse.json({ symbol, degraded: true }, { status: 200 });
    }
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") || "application/json" }
    });
  } catch {
    return NextResponse.json({ symbol, degraded: true }, { status: 200 });
  }
}
