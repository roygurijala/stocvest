import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

type Ctx = { params: { watchlistId: string } };

export async function GET(_req: Request, { params }: Ctx) {
  const id = encodeURIComponent(params.watchlistId);
  const res = await stocvestAuthedFetch(`/v1/watchlists/${id}`, { method: "GET" });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const id = encodeURIComponent(params.watchlistId);
  const payload = await req.json().catch(() => ({}));
  const res = await stocvestAuthedFetch(`/v1/watchlists/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const id = encodeURIComponent(params.watchlistId);
  const res = await stocvestAuthedFetch(`/v1/watchlists/${id}`, { method: "DELETE" });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
