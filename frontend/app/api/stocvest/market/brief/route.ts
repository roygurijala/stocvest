import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/**
 * Proxies GET /v1/market/brief for Client Components (session-cookie auth).
 *
 * Returns the cached, AI-written plain-English market narrative. Degrades to
 * `{ available: false }` on any failure (including pre-deploy 404) so the brief
 * falls back to its deterministic on-device summary without surfacing an error.
 */
export async function GET() {
  try {
    const res = await stocvestAuthedFetch("/v1/market/brief", { method: "GET" });
    if (res.ok) {
      const text = await res.text();
      return new Response(text, {
        status: 200,
        headers: { "content-type": res.headers.get("content-type") || "application/json" }
      });
    }
    return NextResponse.json({ available: false, narrative: null }, { status: 200 });
  } catch {
    return NextResponse.json({ available: false, narrative: null }, { status: 200 });
  }
}
