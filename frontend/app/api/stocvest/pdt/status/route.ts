import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.toString();
  const path = q ? `/v1/pdt/status?${q}` : "/v1/pdt/status";
  const res = await stocvestAuthedFetch(path);
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
