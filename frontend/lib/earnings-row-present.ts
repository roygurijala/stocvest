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

export type EarningsImpactLevel = "high" | "medium" | "low";

/** Market-cap tiers aligned with dashboard earnings calendar. */
export function earningsImpactLevel(marketCap?: number | null): EarningsImpactLevel {
  const cap = typeof marketCap === "number" && Number.isFinite(marketCap) ? marketCap : 0;
  if (cap >= 200_000_000_000) return "high";
  if (cap >= 20_000_000_000) return "medium";
  return "low";
}

const MEGA_CAP_FALLBACK = new Set([
  "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "AMZN", "META", "BRK.B", "BRK.A", "TSLA", "LLY", "AVGO", "JPM", "V", "UNH"
]);

export function isHighMarketImpact(row: EarningsEvent): boolean {
  if (earningsImpactLevel(row.market_cap) === "high") return true;
  return MEGA_CAP_FALLBACK.has(row.symbol.trim().toUpperCase());
}

/** Section title like mockup: `TODAY · FRI MAY 29` or `MON JUN 1`. */
export function formatEarningsGroupHeader(reportDateIso: string, todayIso: string): string {
  const [y, m, d] = reportDateIso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const weekday = dt.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  const monthDay = dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
  if (reportDateIso === todayIso) return `TODAY · ${weekday} ${monthDay}`;
  return `${weekday} ${monthDay}`;
}
