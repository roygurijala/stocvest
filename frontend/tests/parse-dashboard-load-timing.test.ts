import { describe, expect, test } from "vitest";

import {
  buildDashboardTimingReport,
  firstSegmentMs,
  groupDashboardLoadSamples,
  parseDashboardLoadLogLines
} from "@/lib/dashboard/parse-load-timing-logs";

const SAMPLE_LOG = `
2026-05-15T10:00:01.000Z info [dashboard-load] user_me 95ms
2026-05-15T10:00:01.100Z info [dashboard-load] dashboard_summary 820ms
2026-05-15T10:00:02.000Z info [dashboard-load] scanner_core 3200ms
2026-05-15T10:00:10.000Z info [dashboard-load] user_me 110ms
2026-05-15T10:00:10.200Z info [dashboard-load] dashboard_summary 1200ms
2026-05-15T10:00:11.500Z info [dashboard-load] scanner_core 5100ms
`;

describe("parseDashboardLoadLogLines", () => {
  test("extracts_phase_and_ms_from_mixed_log_lines", () => {
    const entries = parseDashboardLoadLogLines(SAMPLE_LOG);
    expect(entries).toHaveLength(6);
    expect(entries[0]).toEqual({ phase: "user_me", ms: 95 });
    expect(entries[1]).toEqual({ phase: "dashboard_summary", ms: 820 });
  });
});

describe("groupDashboardLoadSamples", () => {
  test("splits_on_user_me_boundaries", () => {
    const entries = parseDashboardLoadLogLines(SAMPLE_LOG);
    const samples = groupDashboardLoadSamples(entries);
    expect(samples).toHaveLength(2);
    expect(firstSegmentMs(samples[0]!)).toBe(95 + 820);
    expect(firstSegmentMs(samples[1]!)).toBe(110 + 1200);
  });
});

describe("buildDashboardTimingReport", () => {
  test("computes_p75_and_milestone_pass_fail", () => {
    const report = buildDashboardTimingReport(parseDashboardLoadLogLines(SAMPLE_LOG));
    const summary = report.byPhase.find((r) => r.phase === "dashboard_summary");
    expect(summary?.p75).toBe(1105);
    expect(report.firstSegment.p75).toBe(1211);
    expect(report.scannerPlusFirst.p75).toBe(5836);
    expect(report.samples).toHaveLength(2);
  });
});
