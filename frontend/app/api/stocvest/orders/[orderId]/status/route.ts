import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

export async function GET(req: Request, { params }: { params: { orderId: string } }) {
  const { searchParams } = new URL(req.url);
  const broker = searchParams.get("broker") || "";
  const accountId = searchParams.get("account_id") || "";
  const q = new URLSearchParams({ broker, account_id: accountId }).toString();
  const res = await stocvestAuthedFetch(`/v1/orders/${encodeURIComponent(params.orderId)}/status?${q}`);
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
