import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

const UPSTREAM_MS = 20_000;
const UPSTREAM_UNAVAILABLE = new Set([502, 503, 504]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const path = `/v1/signals/gap-intel${qs ? `?${qs}` : ""}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_MS);
  try {
    const res = await stocvestAuthedFetch(path, { method: "GET", signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    if (UPSTREAM_UNAVAILABLE.has(res.status)) {
      return NextResponse.json(
        {
          error: "upstream_unavailable",
          symbol: url.searchParams.get("symbol") ?? "",
          message: "Gap intelligence is temporarily unavailable. Try again in a moment."
        },
        { status: 200 }
      );
    }
    return NextResponse.json(body, { status: res.status });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return NextResponse.json(
      {
        error: aborted ? "timeout" : "upstream_unavailable",
        symbol: url.searchParams.get("symbol") ?? "",
        message: aborted
          ? "Gap intelligence timed out. Try again in a moment."
          : "Gap intelligence is temporarily unavailable. Try again in a moment."
      },
      { status: 200 }
    );
  } finally {
    clearTimeout(timer);
  }
}
