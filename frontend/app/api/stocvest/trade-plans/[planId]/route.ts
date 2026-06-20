import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

export async function DELETE(_req: Request, ctx: { params: { planId: string } }) {
  const planId = decodeURIComponent(ctx.params.planId ?? "").trim();
  const res = await stocvestAuthedFetch(`/v1/trade-plans/${encodeURIComponent(planId)}`, {
    method: "DELETE"
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
