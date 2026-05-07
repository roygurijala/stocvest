/** Client-safe earnings timing labels (no API / session imports). */

export type EarningsReportTime = "before_market" | "after_market" | "during_market" | "unknown";

export function earningsTimingLabel(reportTime: EarningsReportTime | string): "BMO" | "AMC" | "DURING" | "TBD" {
  if (reportTime === "before_market") return "BMO";
  if (reportTime === "after_market") return "AMC";
  if (reportTime === "during_market") return "DURING";
  return "TBD";
}
