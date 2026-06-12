import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";
import { isUpstreamUnavailable, stocvestAuthedReadWithRetry } from "@/lib/bff/read-route-degrade";

export async function GET() {
  try {
    const res = await stocvestAuthedReadWithRetry("/v1/watchlists/default/symbols", { method: "GET" });
    if (isUpstreamUnavailable(res.status)) {
      return NextResponse.json({ symbols: [], symbol_tracking: {}, degraded: true }, { status: 200 });
    }
    const body = await res.json().catch(() => ({}));
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json({ symbols: [], symbol_tracking: {}, degraded: true }, { status: 200 });
  }
}

export async function POST(req: Request) {
  const payload = await req.json().catch(() => ({}));
  const res = await stocvestAuthedFetch("/v1/watchlists/default/symbols", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
