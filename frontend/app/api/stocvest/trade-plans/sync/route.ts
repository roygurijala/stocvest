import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

export async function PUT(req: Request) {
  const payload = await req.json().catch(() => ({}));
  const res = await stocvestAuthedFetch("/v1/trade-plans/sync", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => []);
  return NextResponse.json(body, { status: res.status });
}
