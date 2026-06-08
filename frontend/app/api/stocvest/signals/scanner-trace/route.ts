import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/** Proxies GET /v1/signals/scanner-trace for Client Components. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const qs = u.searchParams.toString();
  const upstream = qs ? `/v1/signals/scanner-trace?${qs}` : "/v1/signals/scanner-trace";
  try {
    const res = await stocvestAuthedFetch(upstream, { method: "GET" });
    if (res.status >= 500) {
      return NextResponse.json({ traces: [], degraded: true }, { status: 200 });
    }
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") || "application/json" }
    });
  } catch {
    return NextResponse.json({ traces: [], degraded: true }, { status: 200 });
  }
}
