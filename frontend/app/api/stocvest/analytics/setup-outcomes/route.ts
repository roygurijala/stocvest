import { NextRequest, NextResponse } from "next/server";
import { isUpstreamUnavailable, stocvestAuthedReadWithRetry } from "@/lib/bff/read-route-degrade";

const EMPTY_STATS = {
  total_events: 0,
  building_dataset: true,
  by_kind: {},
  alignment_held_rate: null,
  setup_continuation_rate: null,
  symbols_with_events: 0
};

/** Proxies GET /v1/analytics/setup-outcomes with retry + degrade on upstream 503. */
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("mode") || "swing";
  const days = req.nextUrl.searchParams.get("days") || "30";
  const qs = new URLSearchParams({
    mode: mode === "day" ? "day" : "swing",
    days
  }).toString();
  try {
    const res = await stocvestAuthedReadWithRetry(`/v1/analytics/setup-outcomes?${qs}`, {
      method: "GET"
    });
    if (isUpstreamUnavailable(res.status)) {
      return NextResponse.json(
        {
          mode: mode === "day" ? "day" : "swing",
          days: Number(days) || 30,
          has_full_access: false,
          watchlist_symbol_count: 0,
          stats: EMPTY_STATS,
          events: [],
          disclaimer: "Setup outcomes temporarily unavailable.",
          degraded: true
        },
        { status: 200 }
      );
    }
    const body = await res.json().catch(() => ({}));
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json(
      {
        mode: mode === "day" ? "day" : "swing",
        days: Number(days) || 30,
        has_full_access: false,
        watchlist_symbol_count: 0,
        stats: EMPTY_STATS,
        events: [],
        disclaimer: "Setup outcomes temporarily unavailable.",
        degraded: true
      },
      { status: 200 }
    );
  }
}
