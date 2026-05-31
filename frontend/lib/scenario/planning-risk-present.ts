/**
 * Soft Layer 3 — risk as % of entry vs preset caps (warnings only, not actionable gates).
 */

import type { ScenarioPresetId } from "@/lib/scenario/scenario-variants";

export const PRESET_MAX_RISK_PCT: Record<ScenarioPresetId, number> = {
  dip: 1.5,
  continuation: 3,
  breakout: 4
};

export function riskPctOfEntry(
  direction: "bullish" | "bearish",
  entry: number,
  stop: number
): number | null {
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(stop)) return null;
  const risk = direction === "bullish" ? entry - stop : stop - entry;
  if (risk <= 1e-6) return null;
  return Math.round((risk / entry) * 10000) / 100;
}

export type PresetRiskCapEvaluation = {
  preset: ScenarioPresetId;
  riskPct: number;
  capPct: number;
  withinCap: boolean;
  message: string | null;
};

export function evaluatePresetRiskCap(
  preset: ScenarioPresetId,
  riskPct: number | null
): PresetRiskCapEvaluation | null {
  if (riskPct == null || !Number.isFinite(riskPct)) return null;
  const capPct = PRESET_MAX_RISK_PCT[preset];
  const withinCap = riskPct <= capPct + 1e-6;
  return {
    preset,
    riskPct,
    capPct,
    withinCap,
    message: withinCap
      ? null
      : `Risk ${riskPct.toFixed(2)}% of entry exceeds ${preset} cap (${capPct}% max) — consider wider stop or smaller size.`
  };
}

export function formatRiskPctLine(riskPct: number | null): string {
  if (riskPct == null) return "Risk % of entry: unavailable";
  return `Risk ${riskPct.toFixed(2)}% of entry`;
}
