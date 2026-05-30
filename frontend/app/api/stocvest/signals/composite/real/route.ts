import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

const UPSTREAM_MS = 28_000;

export async function POST(req: Request) {
  const payload = await req.json().catch(() => ({}));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_MS);
  try {
    const res = await stocvestAuthedFetch("/v1/signals/composite/real", {
      method: "POST",
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const body = await res.json().catch(() => ({}));
    if (res.status >= 500 || res.status === 429) {
      const transport =
        res.status === 429
          ? ("rate_limited" as const)
          : ("upstream_unavailable" as const);
      const message =
        res.status === 429
          ? "Too many requests. Wait a moment and try again."
          : "The signal service is temporarily unavailable. Try again in a moment.";
      return NextResponse.json(
        {
          error: transport,
          message,
          disclaimer: typeof body.disclaimer === "string" ? body.disclaimer : undefined
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
        message: aborted
          ? "Signal analysis timed out. Try again in a moment."
          : "The signal service is temporarily unavailable. Try again in a moment."
      },
      { status: 200 }
    );
  } finally {
    clearTimeout(timer);
  }
}
