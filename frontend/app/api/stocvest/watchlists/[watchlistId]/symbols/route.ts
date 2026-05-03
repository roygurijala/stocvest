import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

type Ctx = { params: { watchlistId: string } };

export async function POST(req: Request, { params }: Ctx) {
  const id = encodeURIComponent(params.watchlistId);
  const payload = await req.json().catch(() => ({}));
  const res = await stocvestAuthedFetch(`/v1/watchlists/${id}/symbols`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
