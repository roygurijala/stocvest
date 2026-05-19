import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/** Proxies GET /v1/market/vix-snapshot (Lambda Polygon + indices fallback). */
export async function GET() {
  try {
    const res = await stocvestAuthedFetch("/v1/market/vix-snapshot", { method: "GET" });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") || "application/json" }
    });
  } catch {
    return NextResponse.json({ snapshot: null }, { status: 502 });
  }
}
