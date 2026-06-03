import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/**
 * GET /api/stocvest/market/symbol-names?symbols=AAPL,MSFT
 * Proxies to the backend ticker-name resolver. Company names are decorative, so
 * any failure degrades to an empty map (callers fall back to the bare ticker).
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const symbols = (u.searchParams.get("symbols") ?? "").trim();
  if (!symbols) {
    return NextResponse.json({ names: {} }, { status: 200 });
  }
  try {
    const res = await stocvestAuthedFetch(
      `/v1/market/symbol-names?symbols=${encodeURIComponent(symbols)}`,
      { method: "GET" }
    );
    if (res.ok) {
      const text = await res.text();
      return new Response(text, {
        status: 200,
        headers: { "content-type": res.headers.get("content-type") || "application/json" }
      });
    }
  } catch {
    /* fall through to empty map */
  }
  return NextResponse.json({ names: {} }, { status: 200 });
}
