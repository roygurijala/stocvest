/** Interpretation-first copy for quiet scanner days (no engine-debug framing). */

import type { ScannerSynthesis } from "@/lib/scanner-synthesis";
import type { ScannerScanSummary } from "@/lib/scanner-scan-summary";

export function buildScannerQuietSubline(
  summary: ScannerScanSummary,
  synthesis?: ScannerSynthesis | null
): string {
  if (summary.qualifying.total > 0) {
    return summary.quiet.unified_headline;
  }
  const condition = synthesis?.volume_context?.market_condition?.toLowerCase() ?? "";
  if (condition.includes("low")) return "Market quiet — low participation";
  if (condition.includes("below")) return "Market quiet — below-average participation";
  if (summary.near_qualification.length > 0) {
    return summary.quiet.unified_headline;
  }
  const regime = summary.regime.label.toLowerCase();
  if (regime.includes("bear")) return "Market quiet — risk-off regime";
  return "Market quiet — low participation";
}

export function buildScannerCauseBullets(
  summary: ScannerScanSummary,
  synthesis?: ScannerSynthesis | null
): string[] {
  const sessionVolCount = synthesis?.rejection_groups.session_volume.length ?? 0;
  const volQuiet =
    synthesis?.volume_context?.market_condition?.toLowerCase().includes("low") ||
    synthesis?.volume_context?.market_condition?.toLowerCase().includes("below");

  const participation =
    volQuiet || sessionVolCount >= 2
      ? "Market participation is low"
      : "Volume and participation have not reached scanner thresholds";

  const spy = summary.regime.spy_pct;
  const qqq = summary.regime.qqq_pct;
  const leadersQuiet =
    spy != null && qqq != null && spy <= 0.15 && qqq <= 0.15
      ? "Leaders are not confirming moves"
      : "Broad index leadership is not confirming follow-through";

  const regime = summary.regime.label.toLowerCase();
  const regimeLine = regime.includes("bear")
    ? "Current regime blocks setups"
    : regime.includes("bull")
      ? "Constructive regime — per-symbol gates still blocking entries"
      : "Current regime blocks setups";

  return [participation, leadersQuiet, regimeLine];
}

export type ClosestToQualifyingLine = {
  symbol: string;
  note: string;
};

export function buildClosestToQualifyingLines(
  synthesis?: ScannerSynthesis | null,
  summary?: ScannerScanSummary | null
): ClosestToQualifyingLine[] {
  if (synthesis?.near_misses?.length) {
    return synthesis.near_misses.map((nm) => ({
      symbol: nm.symbol,
      note: nm.is_market_proxy
        ? "Session volume lagging — recovery here signals broader pickup"
        : nm.structure_note.replace(/^Session pace lagging; /i, "") || "Volume below intraday pace"
    }));
  }
  const near = summary?.near_qualification ?? [];
  return near.slice(0, 3).map((row) => ({
    symbol: row.symbol,
    note:
      row.desk === "day"
        ? "Strength present — session gates not cleared"
        : "Structure developing — score below threshold"
  }));
}
