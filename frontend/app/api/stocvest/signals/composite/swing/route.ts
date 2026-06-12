import { NextResponse } from "next/server";
import {
  BFF_READ_MAX_ATTEMPTS,
  BFF_READ_RETRY_BASE_MS,
  isUpstreamUnavailable
} from "@/lib/bff/bff-retry-config";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

const UPSTREAM_MS = 28_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stocvestAuthedPostWithRetry(
  path: string,
  body: string,
  signal: AbortSignal
): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < BFF_READ_MAX_ATTEMPTS; attempt++) {
    try {
      last = await stocvestAuthedFetch(path, {
        method: "POST",
        body,
        signal
      });
    } catch (err) {
      if (attempt === BFF_READ_MAX_ATTEMPTS - 1) throw err;
      await sleep(BFF_READ_RETRY_BASE_MS * (attempt + 1));
      continue;
    }
    if (last.ok || !isUpstreamUnavailable(last.status) || attempt === BFF_READ_MAX_ATTEMPTS - 1) {
      return last;
    }
    await sleep(BFF_READ_RETRY_BASE_MS * (attempt + 1));
  }
  return last!;
}

export async function POST(req: Request) {
  const payload = await req.json().catch(() => ({}));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_MS);
  try {
    const res = await stocvestAuthedPostWithRetry(
      "/v1/signals/composite/swing",
      JSON.stringify(payload),
      controller.signal
    );
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
