import type { AdminDashboardLoadTimingsPayload } from "@/lib/api/admin-dashboard-timing";
import { isSessionAdmin } from "@/lib/auth/admin";
import { getServerSession } from "@/lib/auth/session";
import {
  isUpstashRedisConfigured,
  readDashboardTimingLogEntriesFromRedis
} from "@/lib/dashboard/dashboard-timing-redis";
import { getDashboardTimingSettingsSnapshot } from "@/lib/dashboard/load-timing";
import {
  buildDashboardTimingReport,
  formatDashboardTimingReport
} from "@/lib/dashboard/parse-load-timing-logs";

/**
 * Admin-only: read recent `/dashboard` `[dashboard-load]` samples from Upstash
 * and current timing-toggle settings (see POST `/api/stocvest/admin/dashboard-timing-settings`).
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

  const redisConfigured = isUpstashRedisConfigured();
  if (!redisConfigured) {
    const body: AdminDashboardLoadTimingsPayload = {
      settings,
      redisConfigured: false,
      eventCount: 0,
      sampleCount: 0,
      formattedReport:
        "Upstash Redis is not configured on this Next.js deployment (set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN). Dashboard timing samples are only buffered when Redis is available."
    };
    return Response.json(body);
  }

  const entries = await readDashboardTimingLogEntriesFromRedis();
  if (entries === null) {
    const body: AdminDashboardLoadTimingsPayload = {
      settings,
      redisConfigured: true,
      readFailed: true,
      eventCount: 0,
      sampleCount: 0,
      formattedReport:
        "Could not read timing samples from Redis. Check Vercel logs and Upstash credentials."
    };
    return Response.json(body);
  }

  const report = buildDashboardTimingReport(entries);
  const body: AdminDashboardLoadTimingsPayload = {
    settings,
    redisConfigured: true,
    eventCount: entries.length,
    sampleCount: report.samples.length,
    formattedReport: formatDashboardTimingReport(report)
  };
  return Response.json(body);
}
