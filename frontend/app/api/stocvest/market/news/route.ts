import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/**
 * Proxies GET /v1/market/news for Client Components (session-cookie auth).
 *
 * With no `symbol`, the upstream returns the market-intelligence feed
 * (`{ headlines: [...] }`) — impact-analyzed, relevance-ranked, publisher-diverse
 * headlines used by the dashboard brief. A `symbol` (and other params) pass through
 * for the symbol-scoped panel. Degrades to an empty feed on any failure.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const qs = u.searchParams.toString();
  const upstream = qs ? `/v1/market/news?${qs}` : "/v1/market/news";
  try {
    const res = await stocvestAuthedFetch(upstream, { method: "GET" });
    const text = await res.text();
    if (res.ok) {
      return new Response(text, {
        status: 200,
        headers: { "content-type": res.headers.get("content-type") || "application/json" }
      });
    }
    return NextResponse.json({ headlines: [] }, { status: 200 });
  } catch {
    return NextResponse.json({ headlines: [] }, { status: 200 });
  }
}
