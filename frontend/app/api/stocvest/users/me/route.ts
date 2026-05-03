import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

export async function GET() {
  const res = await stocvestAuthedFetch("/v1/users/me", { method: "GET" });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}

export async function PATCH(req: Request) {
  const payload = await req.json().catch(() => ({}));
  const res = await stocvestAuthedFetch("/v1/users/me", {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
