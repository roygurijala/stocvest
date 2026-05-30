/**
 * Live verdict banner for Scenario Builder — strict desk gates on the user's geometry.
 *
 * Green only when the system decision is actionable AND the user's entry/stop/target
 * clears the desk R/R minimum AND no other reinforcement blockers remain.
 */

import { minRiskRewardForVerdict } from "@/lib/trade-conviction-tier";
import type { ScenarioMode } from "@/lib/scenario/types";
import { scenarioGeometryError } from "@/lib/scenario/scenario-geometry";
import { remainingBlockersAfterScenarioRr } from "@/lib/scenario/scenario-variants";
import {
  hasWeakExecutionTiming,
  weakExecutionTimingDetail,
  type ScenarioExecutionTiming
} from "@/lib/scenario/scenario-execution-timing";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";

export type ScenarioVerdictTone = "red" | "amber" | "green";

export type ScenarioVerdict = {
  tone: ScenarioVerdictTone;
  headline: string;
  detail: string;
  blockers: string[];
  scenarioRr: number | null;
  deskMinRr: number;
  clearsDeskRr: boolean;
};

function rrFromLevels(
  entry: number,
  stop: number,
  target: number,
  direction: "bullish" | "bearish"
): number | null {
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(target)) return null;
  if (direction === "bullish") {
    const risk = entry - stop;
    const reward = target - entry;
    if (risk <= 1e-6 || reward <= 1e-6) return null;
    return Math.round((reward / risk) * 10000) / 10000;
  }
  const risk = stop - entry;
  const reward = entry - target;
  if (risk <= 1e-6 || reward <= 1e-6) return null;
  return Math.round((reward / risk) * 10000) / 10000;
}

export function scenarioClearsDeskRrGate(riskReward: number, mode: ScenarioMode): boolean {
  return Number.isFinite(riskReward) && riskReward >= minRiskRewardForVerdict(mode);
}

export function resolveScenarioVerdict(args: {
  systemDecision: TradeDecision;
  mode: ScenarioMode;
  direction: "bullish" | "bearish";
  entry: number;
  stop: number;
  target: number;
  executionTiming?: ScenarioExecutionTiming;
}): ScenarioVerdict {
  const deskMinRr = minRiskRewardForVerdict(args.mode);
  const geometryError = scenarioGeometryError(
    args.direction,
    args.entry,
    args.stop,
    args.target
  );
  if (geometryError) {
    return {
      tone: "red",
      headline: "Invalid trade geometry",
      detail: geometryError,
      blockers: [geometryError],
      scenarioRr: null,
      deskMinRr,
      clearsDeskRr: false
    };
  }

  const scenarioRr = rrFromLevels(args.entry, args.stop, args.target, args.direction);
  const clearsDeskRr =
    scenarioRr != null && scenarioClearsDeskRrGate(scenarioRr, args.mode);
  const blockers = remainingBlockersAfterScenarioRr(args.systemDecision, clearsDeskRr);
  const weakTiming = hasWeakExecutionTiming(args.executionTiming, args.systemDecision);
  const timingDetail = weakExecutionTimingDetail(args.executionTiming, args.systemDecision);
  const timingBlockers = timingDetail ? [timingDetail] : [];

  if (args.systemDecision.state === "blocked") {
    return {
      tone: "red",
      headline: "We do not recommend planning this trade",
      detail:
        "Minimum synthesis and risk gates are not met on the Signals desk. Adjust geometry below for learning only — this is not trade permission.",
      blockers,
      scenarioRr,
      deskMinRr,
      clearsDeskRr
    };
  }

  if (
    args.systemDecision.state === "actionable" &&
    clearsDeskRr &&
    blockers.length === 0 &&
    !weakTiming
  ) {
    return {
      tone: "green",
      headline: "Checks passed for this scenario layout",
      detail: `Your plan meets desk thresholds (${deskMinRr.toFixed(1)} : 1 R/R minimum and setup gates). This is planning math only — not a trade recommendation.`,
      blockers: [],
      scenarioRr,
      deskMinRr,
      clearsDeskRr
    };
  }

  const mergedBlockers = [...timingBlockers, ...blockers].filter(
    (line, idx, arr) => arr.indexOf(line) === idx
  );

  const rrLine =
    scenarioRr != null
      ? clearsDeskRr
        ? `Scenario R/R is ${scenarioRr.toFixed(1)} : 1 (meets ${deskMinRr.toFixed(1)} : 1 desk minimum).`
        : `Scenario R/R is ${scenarioRr.toFixed(1)} : 1 — below ${deskMinRr.toFixed(1)} : 1 desk minimum.`
      : "Enter valid entry, stop, and target to compute scenario R/R.";

  const nonRrBlockers = mergedBlockers.filter((line) => !/risk\s*\/?\s*reward|r\/r/i.test(line));

  if (!clearsDeskRr) {
    return {
      tone: "red",
      headline: "We do not recommend this trade yet",
      detail: `${rrLine} Other setup or execution gates may still apply.`,
      blockers: nonRrBlockers,
      scenarioRr,
      deskMinRr,
      clearsDeskRr
    };
  }

  return {
    tone: "amber",
    headline: "We do not recommend this trade yet",
    detail: `${rrLine} Other setup or execution gates may still apply.`,
    blockers: mergedBlockers,
    scenarioRr,
    deskMinRr,
    clearsDeskRr
  };
}
