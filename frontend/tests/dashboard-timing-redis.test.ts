import { describe, expect, test } from "vitest";

import { redisRowsToLogEntries } from "@/lib/dashboard/dashboard-timing-redis";
import { buildDashboardTimingReport } from "@/lib/dashboard/parse-load-timing-logs";

describe("dashboard-timing-redis", () => {
  test("redisRowsToLogEntries sorts by timestamp and yields phase rows", () => {
    const rows = [
      JSON.stringify({ t: "2026-01-02T00:00:02.000Z", phase: "scanner_core", ms: 100 }),
      JSON.stringify({ t: "2026-01-02T00:00:00.000Z", phase: "user_me", ms: 10 }),
      JSON.stringify({ t: "2026-01-02T00:00:01.000Z", phase: "dashboard_summary", ms: 50 })
    ];
    expect(redisRowsToLogEntries(rows)).toEqual([
      { phase: "user_me", ms: 10 },
      { phase: "dashboard_summary", ms: 50 },
      { phase: "scanner_core", ms: 100 }
    ]);
  });

  test("redisRowsToLogEntries survives bad JSON and invalid rows", () => {
    expect(redisRowsToLogEntries(["not-json", "{}", '{"phase":"x"}'])).toEqual([]);
    expect(redisRowsToLogEntries([JSON.stringify({ phase: "user_me", ms: 5 })])).toEqual([
      { phase: "user_me", ms: 5 }
    ]);
  });

  test("full pipeline matches two-sample fixture shape", () => {
    const rows = [
      JSON.stringify({ t: "2026-01-02T00:00:00.000Z", phase: "user_me", ms: 88 }),
      JSON.stringify({ t: "2026-01-02T00:00:01.000Z", phase: "dashboard_summary", ms: 700 }),
      JSON.stringify({ t: "2026-01-02T00:00:04.000Z", phase: "scanner_core", ms: 2000 }),
      JSON.stringify({ t: "2026-01-02T00:01:00.000Z", phase: "user_me", ms: 90 }),
      JSON.stringify({ t: "2026-01-02T00:01:01.000Z", phase: "dashboard_summary", ms: 900 }),
      JSON.stringify({ t: "2026-01-02T00:01:03.000Z", phase: "scanner_core", ms: 3000 })
    ];
    const entries = redisRowsToLogEntries(rows);
    const report = buildDashboardTimingReport(entries);
    expect(report.samples).toHaveLength(2);
    expect(report.byPhase.find((p) => p.phase === "user_me")?.count).toBe(2);
    expect(report.firstSegment.count).toBe(2);
  });
});
