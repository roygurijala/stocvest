import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

export const runtime = "edge";

const DASHBOARD_KEYS = {
  swing_signals: "stocvest:dashboard:top_signals_swing",
  day_signals: "stocvest:dashboard:top_signals_day",
  market_pulse: "stocvest:dashboard:market_pulse",
  sector_rotation: "stocvest:dashboard:sector_rotation",
  upcoming_events: "stocvest:dashboard:upcoming_events",
  active_positions: "stocvest:dashboard:active_positions",
  geo_themes: "stocvest:geo_themes:today"
} as const;

function redisOrNull(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode") ?? "swing";

  const redis = redisOrNull();
  if (!redis) {
    return NextResponse.json(
      {
        mode,
        served_at: new Date().toISOString(),
        source: "edge_cache_unconfigured",
        swing_signals: null,
        day_signals: null,
        market_pulse: null,
        sector_rotation: null,
        upcoming_events: null,
        active_positions: null,
        geo_themes: null
      },
      { status: 200 }
    );
  }

  const [
    swingSignals,
    daySignals,
    marketPulse,
    sectorRotation,
    upcomingEvents,
    activePositions,
    geoThemes
  ] = await Promise.allSettled([
    redis.get(DASHBOARD_KEYS.swing_signals),
    redis.get(DASHBOARD_KEYS.day_signals),
    redis.get(DASHBOARD_KEYS.market_pulse),
    redis.get(DASHBOARD_KEYS.sector_rotation),
    redis.get(DASHBOARD_KEYS.upcoming_events),
    redis.get(DASHBOARD_KEYS.active_positions),
    redis.get(DASHBOARD_KEYS.geo_themes)
  ]);

  const getValue = (result: PromiseSettledResult<unknown>) =>
    result.status === "fulfilled" ? result.value : null;

  const swing_signals = getValue(swingSignals);
  const day_signals = getValue(daySignals);
  const market_pulse = getValue(marketPulse);
  const sector_rotation = getValue(sectorRotation);
  const upcoming_events = getValue(upcomingEvents);
  const active_positions = getValue(activePositions);
  const geo_themes = getValue(geoThemes);

  const allMiss =
    swing_signals == null &&
    day_signals == null &&
    market_pulse == null &&
    sector_rotation == null &&
    upcoming_events == null &&
    active_positions == null &&
    geo_themes == null;

  const response = {
    mode,
    served_at: new Date().toISOString(),
    source: (allMiss ? "edge_cache_miss" : "edge_cache") as const,
    swing_signals,
    day_signals,
    market_pulse,
    sector_rotation,
    upcoming_events,
    active_positions,
    geo_themes
  };

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300"
    }
  });
}
