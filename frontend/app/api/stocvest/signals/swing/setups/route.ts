import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/** Proxies POST /v1/signals/swing/setups for Client Components. */
export async function POST(req: Request) {
  const body = await req.text();
  try {
    const res = await stocvestAuthedFetch("/v1/signals/swing/setups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body
    });
    if (res.status >= 500) {
      return NextResponse.json({ setups: [], degraded: true }, { status: 200 });
    }
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") || "application/json" }
    });
  } catch {
    return NextResponse.json({ setups: [], degraded: true }, { status: 200 });
  }
}
