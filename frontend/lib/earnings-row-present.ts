import type { EarningsEvent } from "@/lib/api/earnings-types";

/** Human-readable company label; hide duplicate symbol-as-name from API. */
export function earningsCompanyLabel(row: EarningsEvent): string {
  const sym = row.symbol.trim().toUpperCase();
  const cn = (row.company_name || "").trim();
  if (cn && cn.toUpperCase() !== sym) return cn;
  return sym;
}

/** True when reported EPS should appear in the Actual column (not a future report date). */
export function earningsShowsReportedActual(row: EarningsEvent, todayIso: string): boolean {
  if (typeof row.actual_eps !== "number" || !Number.isFinite(row.actual_eps)) return false;
  return row.report_date <= todayIso;
}

export function formatEarningsReportDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function earningsTimingLabel(
  reportTime: EarningsEvent["report_time"]
): "BMO" | "AMC" | "DURING" | "TBD" {
  if (reportTime === "before_market") return "BMO";
  if (reportTime === "after_market") return "AMC";
  if (reportTime === "during_market") return "DURING";
  return "TBD";
}
