/**
 * Parse `[dashboard-load] <phase> <ms>ms` lines from server logs (Tier 1.C measurement).
 * Used by `scripts/parse_dashboard_load_timing.ts` and Vitest lock-ins.
 */

/** Keep in sync with `dashboard-slo.ts` (avoid importing `dashboard-page-data` for CLI use). */
const DASHBOARD_SLO_TARGETS = {
  firstContentfulP75Ms: 2000,
  scannerDesksUsableP75Ms: 8000,
  productHardCeilingMs: 15_000
} as const;

const DASHBOARD_LOAD_PHASES = [
  "user_me",
  "dashboard_summary",
  "market_overview",
  "daily_bar_closes",
  "earnings_calendar",
  "scanner_core"
] as const;

const LOG_LINE_RE = /\[dashboard-load\]\s+(\S+)\s+(\d+)ms/g;

export type DashboardLoadLogEntry = {
  phase: string;
  ms: number;
};

export type PhaseStats = {
  phase: string;
  count: number;
  min: number;
  p50: number;
  p75: number;
  p95: number;
  max: number;
};

export type DashboardLoadRequestSample = {
  phases: Record<string, number>;
};

export type MilestoneStats = {
  count: number;
  p50: number;
  p75: number;
  p95: number;
  max: number;
};

export type DashboardTimingReport = {
  entries: DashboardLoadLogEntry[];
  byPhase: PhaseStats[];
  samples: DashboardLoadRequestSample[];
  firstSegment: MilestoneStats;
  scannerPlusFirst: MilestoneStats;
};

/** Extract timing rows from raw log text (stdout, Vercel, CloudWatch, etc.). */
export function parseDashboardLoadLogLines(text: string): DashboardLoadLogEntry[] {
  const out: DashboardLoadLogEntry[] = [];
  if (!text) return out;
  for (const match of text.matchAll(LOG_LINE_RE)) {
    const phase = match[1]?.trim();
    const ms = Number(match[2]);
    if (!phase || !Number.isFinite(ms)) continue;
    out.push({ phase, ms });
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const w = rank - lo;
  return Math.round(sorted[lo]! * (1 - w) + sorted[hi]! * w);
}

function statsForValues(phase: string, values: number[]): PhaseStats {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    phase,
    count: sorted.length,
    min: sorted[0] ?? 0,
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] ?? 0
  };
}

/** Group log lines into per-request samples (each `/dashboard` RSC load starts with `user_me`). */
export function groupDashboardLoadSamples(entries: DashboardLoadLogEntry[]): DashboardLoadRequestSample[] {
  const samples: DashboardLoadRequestSample[] = [];
  let current: Record<string, number> = {};

  const flush = () => {
    if (Object.keys(current).length > 0) {
      samples.push({ phases: { ...current } });
    }
    current = {};
  };

  for (const { phase, ms } of entries) {
    if (phase === "user_me" && Object.keys(current).length > 0) {
      flush();
    }
    current[phase] = ms;
  }
  flush();
  return samples;
}

/** First RSC segment: `user_me` + summary (or legacy market/daily max). */
export function firstSegmentMs(sample: DashboardLoadRequestSample): number {
  const p = sample.phases;
  const userMe = p.user_me ?? 0;
  let dataMs = 0;
  if (typeof p.dashboard_summary === "number") {
    dataMs = p.dashboard_summary;
  } else {
    dataMs = Math.max(p.market_overview ?? 0, p.daily_bar_closes ?? 0);
  }
  return userMe + dataMs;
}

/** Server-side proxy for “desks usable”: first segment + deferred `scanner_core`. */
export function scannerReadyMs(sample: DashboardLoadRequestSample): number {
  return firstSegmentMs(sample) + (sample.phases.scanner_core ?? 0);
}

function milestoneStats(values: number[]): MilestoneStats {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] ?? 0
  };
}

/** Build per-phase and milestone aggregates for reporting. */
export function buildDashboardTimingReport(entries: DashboardLoadLogEntry[]): DashboardTimingReport {
  const byPhaseMap = new Map<string, number[]>();
  for (const { phase, ms } of entries) {
    const list = byPhaseMap.get(phase) ?? [];
    list.push(ms);
    byPhaseMap.set(phase, list);
  }

  const knownOrder = [...DASHBOARD_LOAD_PHASES];
  const extraPhases = [...byPhaseMap.keys()].filter((p) => !knownOrder.includes(p as (typeof knownOrder)[number]));
  const phaseOrder = [...knownOrder, ...extraPhases.sort()];

  const byPhase = phaseOrder
    .filter((phase) => byPhaseMap.has(phase))
    .map((phase) => statsForValues(phase, byPhaseMap.get(phase)!));

  const samples = groupDashboardLoadSamples(entries);
  const firstValues = samples.map(firstSegmentMs);
  const scannerValues = samples.map(scannerReadyMs);

  return {
    entries,
    byPhase,
    samples,
    firstSegment: milestoneStats(firstValues),
    scannerPlusFirst: milestoneStats(scannerValues)
  };
}

function sloStatus(ms: number, budgetMs: number): string {
  return ms < budgetMs ? "PASS" : "FAIL";
}

function pad(label: string, width: number): string {
  return label.padEnd(width);
}

/** Human-readable report for terminal / paste into PERFORMANCE.md. */
export function formatDashboardTimingReport(report: DashboardTimingReport): string {
  const lines: string[] = [];
  lines.push("Dashboard load timing report");
  lines.push(`Samples (page loads): ${report.samples.length}`);
  lines.push(`Log lines parsed: ${report.entries.length}`);
  lines.push("");

  if (report.byPhase.length === 0) {
    lines.push(
      "No [dashboard-load] lines found. Enable timing (admin Dashboard timing page, STOCVEST_DASHBOARD_TIMING=1, or development) and load /dashboard."
    );
    return lines.join("\n");
  }

  lines.push("Per-phase (ms):");
  lines.push("  phase                  n    min   p50   p75   p95   max");
  for (const row of report.byPhase) {
    lines.push(
      `  ${pad(row.phase, 22)} ${String(row.count).padStart(4)} ${String(row.min).padStart(5)} ${String(row.p50).padStart(5)} ${String(row.p75).padStart(5)} ${String(row.p95).padStart(5)} ${String(row.max).padStart(5)}`
    );
  }
  lines.push("");

  if (report.samples.length > 0) {
    const fs = report.firstSegment;
    const sc = report.scannerPlusFirst;
    lines.push("Milestones (server-side proxy, ms):");
    lines.push(
      `  First segment (user_me + summary|market)  n=${fs.count}  p50=${fs.p50}  p75=${fs.p75}  p95=${fs.p95}  max=${fs.max}  target <${DASHBOARD_SLO_TARGETS.firstContentfulP75Ms}  ${sloStatus(fs.p75, DASHBOARD_SLO_TARGETS.firstContentfulP75Ms)}`
    );
    lines.push(
      `  First segment + scanner_core              n=${sc.count}  p50=${sc.p50}  p75=${sc.p75}  p95=${sc.p95}  max=${sc.max}  target <${DASHBOARD_SLO_TARGETS.scannerDesksUsableP75Ms}  ${sloStatus(sc.p75, DASHBOARD_SLO_TARGETS.scannerDesksUsableP75Ms)}`
    );
    lines.push(
      `  Hard ceiling check (max sample)             max=${sc.max}  target <${DASHBOARD_SLO_TARGETS.productHardCeilingMs}  ${sloStatus(sc.max, DASHBOARD_SLO_TARGETS.productHardCeilingMs)}`
    );
    lines.push("");
    lines.push("Paste into PERFORMANCE.md §1 Measured baselines (Production row):");
    const summaryP75 = report.byPhase.find((r) => r.phase === "dashboard_summary")?.p75;
    const summaryCell =
      summaryP75 != null ? `**${summaryP75}ms** P75 (n=${report.byPhase.find((r) => r.phase === "dashboard_summary")?.count})` : "legacy path (no dashboard_summary)";
    lines.push(`  First segment: ${summaryCell}; combined p75=${fs.p75}ms`);
    lines.push(`  Scanner path: scanner_core p75=${report.byPhase.find((r) => r.phase === "scanner_core")?.p75 ?? "—"}ms; milestone p75=${sc.p75}ms`);
  }

  return lines.join("\n");
}
