import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/** Proxies GET /v1/market/status for Client Components (session cookie auth). */
export async function GET() {
  try {
    const res = await stocvestAuthedFetch("/v1/market/status", { method: "GET" });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status >= 500) {
      return NextResponse.json({ market: "", exchanges: {}, currencies: {}, degraded: true }, { status: 200 });
    }
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json({ market: "", exchanges: {}, currencies: {}, degraded: true }, { status: 200 });
  }
}
