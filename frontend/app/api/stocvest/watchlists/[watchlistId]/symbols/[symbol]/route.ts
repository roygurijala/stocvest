import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

type Ctx = { params: { watchlistId: string; symbol: string } };

export async function DELETE(_req: Request, { params }: Ctx) {
  const id = encodeURIComponent(params.watchlistId);
  const sym = encodeURIComponent(params.symbol);
  const res = await stocvestAuthedFetch(`/v1/watchlists/${id}/symbols/${sym}`, { method: "DELETE" });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
