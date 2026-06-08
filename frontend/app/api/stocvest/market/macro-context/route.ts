import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/** Proxies GET /v1/market/macro-context for Client Components (session cookie auth). */
export async function GET() {
  try {
    const res = await stocvestAuthedFetch("/v1/market/macro-context", { method: "GET" });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status >= 500) {
      return NextResponse.json(
        {
          upcoming_events: [],
          warnings: [],
          macro_risk: "unknown",
          yield_curve: null,
          market_regime: null,
          macro_score: null,
          degraded: true
        },
        { status: 200 }
      );
    }
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json(
      {
        upcoming_events: [],
        warnings: [],
        macro_risk: "unknown",
        yield_curve: null,
        market_regime: null,
        macro_score: null,
        degraded: true
      },
      { status: 200 }
    );
  }
}
