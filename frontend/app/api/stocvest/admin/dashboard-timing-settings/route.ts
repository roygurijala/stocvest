import { isSessionAdmin } from "@/lib/auth/admin";
import { getServerSession } from "@/lib/auth/session";
import {
  clearDashboardTimingRedisToggle,
  isUpstashRedisConfigured,
  setDashboardTimingRedisToggle
} from "@/lib/dashboard/dashboard-timing-redis";
import { getDashboardTimingSettingsSnapshot } from "@/lib/dashboard/load-timing";
import type { DashboardTimingSettingsPayload } from "@/lib/api/admin-dashboard-timing";

type TimingMode = "on" | "off" | "default";

function isTimingMode(v: unknown): v is TimingMode {
  return v === "on" || v === "off" || v === "default";
}

/**
 * Admin-only: read timing toggle metadata (same fields as embedded in dashboard-load-timings GET).
 */
export async function GET() {
  const session = getServerSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSessionAdmin(session)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const settings = await getDashboardTimingSettingsSnapshot();
  const body: DashboardTimingSettingsPayload = settings;
  return Response.json(body);
}

/**
 * Admin-only: set runtime dashboard timing (`mode`: on | off | default).
 * Requires Upstash — same as buffering samples to the admin timing page.
 */
export async function POST(req: Request) {
  const session = getServerSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSessionAdmin(session)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isUpstashRedisConfigured()) {
    return Response.json(
      { error: "Redis is not configured; set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN." },
      { status: 503 }
    );
  }

  const env = process.env.STOCVEST_DASHBOARD_TIMING?.trim();
  if (env === "0" || env === "1") {
    return Response.json(
      {
        error:
          "STOCVEST_DASHBOARD_TIMING is set on this deployment; unset it in Vercel env to use the admin toggle."
      },
      { status: 409 }
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const mode =
    typeof json === "object" && json !== null && "mode" in json
      ? (json as { mode: unknown }).mode
      : undefined;
  if (!isTimingMode(mode)) {
    return Response.json({ error: "Body must be { \"mode\": \"on\" | \"off\" | \"default\" }" }, { status: 400 });
  }

  try {
    if (mode === "default") {
      await clearDashboardTimingRedisToggle();
    } else {
      await setDashboardTimingRedisToggle(mode === "on");
    }
  } catch {
    return Response.json({ error: "Failed to update Redis toggle" }, { status: 502 });
  }

  const settings = await getDashboardTimingSettingsSnapshot();
  return Response.json(settings);
}
