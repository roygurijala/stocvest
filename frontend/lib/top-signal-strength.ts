import type { IntradaySetupPayload } from "@/lib/api/scanner";

/**
 * Display percent for top signal cards/rows.
 * Prefer confluence when present, but blend in pattern score to reduce visible ties.
 */
export function topSignalStrengthPercent(setup: IntradaySetupPayload): number {
  const patPct =
    typeof setup.score === "number" && Number.isFinite(setup.score)
      ? Math.max(0, Math.min(100, setup.score * 100))
      : 0;
  if (typeof setup.confluence_score === "number" && Number.isFinite(setup.confluence_score)) {
    const conf = Math.max(0, Math.min(100, setup.confluence_score));
    const blended = conf * 0.78 + patPct * 0.22;
    return Math.max(0, Math.min(100, Math.round(blended)));
  }
  return Math.max(0, Math.min(100, Math.round(patPct)));
}

