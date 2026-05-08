import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(request: Request) {
  const token = request.headers.get("X-Internal-Token");
  if (!token || token !== process.env.INTERNAL_OPS_TOKEN) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !tok) {
    return NextResponse.json(
      { health: {}, checked_at: new Date().toISOString(), note: "upstash_not_configured" },
      { status: 200 }
    );
  }

  const redis = new Redis({ url, token: tok });
  const health = await redis.hgetall("stocvest:ops:layer_health");

  return NextResponse.json({
    health: health ?? {},
    checked_at: new Date().toISOString()
  });
}
