#!/usr/bin/env node
/**
 * Parse `[dashboard-load]` timing lines and print P75 stats vs dashboard SLOs.
 *
 * Usage:
 *   node --experimental-strip-types scripts/parse_dashboard_load_timing.ts [logfile]
 *   vercel logs ... 2>&1 | node --experimental-strip-types scripts/parse_dashboard_load_timing.ts
 *   Get-Content sample.log | node --experimental-strip-types scripts/parse_dashboard_load_timing.ts
 *
 * Enable logs: STOCVEST_DASHBOARD_TIMING=1 on the Next.js server (see docs/PERFORMANCE.md §1).
 */

import { readFileSync } from "node:fs";
import { stdin } from "node:process";
import {
  buildDashboardTimingReport,
  formatDashboardTimingReport,
  parseDashboardLoadLogLines
} from "../frontend/lib/dashboard/parse-load-timing-logs.ts";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const path = process.argv[2];
  const text = path ? readFileSync(path, "utf8") : await readStdin();
  const report = buildDashboardTimingReport(parseDashboardLoadLogLines(text));
  console.log(formatDashboardTimingReport(report));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
