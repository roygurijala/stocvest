import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/** Proxies GET /v1/market/snapshots?symbols=A,B,… for Client Components (session cookie auth). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const symbols = (u.searchParams.get("symbols") ?? "").trim();
  if (!symbols) {
    return NextResponse.json({ snapshots: [] }, { status: 200 });
  }

  try {
    const res = await stocvestAuthedFetch(`/v1/market/snapshots?symbols=${encodeURIComponent(symbols)}`, {
      method: "GET"
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") || "application/json" }
    });
  } catch {
    return NextResponse.json({ snapshots: [] }, { status: 502 });
  }
}
