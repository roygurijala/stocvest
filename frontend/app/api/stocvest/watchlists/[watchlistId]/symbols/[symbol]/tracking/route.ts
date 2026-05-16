import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

type Ctx = { params: { watchlistId: string; symbol: string } };

export async function PATCH(req: Request, { params }: Ctx) {
  const id = encodeURIComponent(params.watchlistId);
  const sym = encodeURIComponent(params.symbol.trim().toUpperCase());
  const payload = await req.json().catch(() => ({}));
  const res = await stocvestAuthedFetch(`/v1/watchlists/${id}/symbols/${sym}/tracking`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
