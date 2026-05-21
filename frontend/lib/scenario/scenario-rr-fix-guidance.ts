/**
 * Actionable R/R fix guidance for reference scenarios (Signals what-if only).
 */

import { SCENARIO_RR_MIN } from "@/lib/scenario/scenario-variants";
import type { ScenarioGeometrySource, ResolvedScenarioLevels } from "@/lib/scenario/scenario-variants";

export type ScenarioRrLeverQuality = "best" | "medium" | "risky";

export type ScenarioRrFixLever = {
  id: "entry" | "stop" | "target";
  quality: ScenarioRrLeverQuality;
  label: string;
  thresholdText: string;
  detail: string;
  calcLine: string;
};

export type ScenarioRrFixBottleneck = "wide_stop" | "limited_target" | "entry_location" | "balanced";

export type ScenarioRrFixGuidance = {
  direction: "bullish" | "bearish";
  entry: number;
  stop: number;
  target: number;
  riskPerShare: number;
  rewardPerShare: number;
  riskReward: number;
  minRr: number;
  requiredReward: number;
  /** How much further target must move to hit min R:R (0 when already sufficient). */
  targetExtensionGap: number;
  diagnosis: string;
  primaryBottleneck: ScenarioRrFixBottleneck;
  levers: ScenarioRrFixLever[];
  warnings: string[];
};

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function riskRewardParts(
  entry: number,
  stop: number,
  target: number,
  direction: "bullish" | "bearish"
): { risk: number; reward: number; rr: number } | null {
  if (direction === "bullish") {
    const risk = entry - stop;
    const reward = target - entry;
    if (risk <= 1e-6 || reward <= 1e-6) return null;
    return { risk: round4(risk), reward: round4(reward), rr: round4(reward / risk) };
  }
  const risk = stop - entry;
  const reward = entry - target;
  if (risk <= 1e-6 || reward <= 1e-6) return null;
  return { risk: round4(risk), reward: round4(reward), rr: round4(reward / risk) };
}

function requiredTargetAtMinRr(
  entry: number,
  stop: number,
  direction: "bullish" | "bearish",
  minRr: number
): number | null {
  const risk = direction === "bullish" ? entry - stop : stop - entry;
  if (risk <= 1e-6) return null;
  return direction === "bullish" ? round4(entry + minRr * risk) : round4(entry - minRr * risk);
}

/** Max stop (bearish) / min stop (bullish) for min R:R with fixed entry + target. */
function stopThresholdForRr(
  entry: number,
  target: number,
  direction: "bullish" | "bearish",
  minRr: number
): number | null {
  const reward = direction === "bullish" ? target - entry : entry - target;
  if (reward <= 1e-6) return null;
  const maxRisk = reward / minRr;
  if (direction === "bullish") {
    const s = entry - maxRisk;
    if (s <= 0 || s >= entry) return null;
    return round4(s);
  }
  const s = entry + maxRisk;
  if (s <= entry) return null;
  return round4(s);
}

/** Min entry (bearish) / max entry (bullish) for min R:R with fixed stop + target. */
function entryThresholdForRr(
  stop: number,
  target: number,
  direction: "bullish" | "bearish",
  minRr: number
): number | null {
  if (direction === "bullish") {
    const e = (2 * stop + target) / 3;
    if (!Number.isFinite(e) || e <= stop || e >= target) return null;
    return round4(e);
  }
  const e = (2 * stop + target) / 3;
  if (!Number.isFinite(e) || e >= stop || e <= target) return null;
  return round4(e);
}

function inferBottleneck(
  risk: number,
  reward: number,
  targetGap: number,
  minRr: number
): ScenarioRrFixBottleneck {
  const requiredReward = minRr * risk;
  const rewardShortfall = Math.max(0, requiredReward - reward);
  if (targetGap > reward * 0.55 && targetGap > risk * 0.45) return "limited_target";
  if (risk > reward * 0.9 || risk > requiredReward * 0.85) return "wide_stop";
  if (rewardShortfall > reward * 0.35) return "entry_location";
  return "balanced";
}

function diagnosisForBottleneck(
  bottleneck: ScenarioRrFixBottleneck,
  direction: "bullish" | "bearish"
): string {
  const side = direction === "bullish" ? "long" : "short";
  switch (bottleneck) {
    case "limited_target":
      return `R:R is insufficient because reachable reward is capped while stop risk stays wide on this ${side}. Best path: improve entry timing before stretching target.`;
    case "wide_stop":
      return `R:R is insufficient mainly due to wide stop risk relative to reachable reward on this ${side}. Best path: wait for a better entry; only tighten stop if structure supports it.`;
    case "entry_location":
      return `R:R is insufficient — entry location dominates on this ${side}. Best path: wait for a better fill in the zone rather than forcing target extension.`;
    default:
      return `R:R is below the ${SCENARIO_RR_MIN.toFixed(1)} : 1 gate — combine a better entry with modest stop or target adjustments; avoid fantasy targets.`;
  }
}

function buildWarnings(args: {
  direction: "bullish" | "bearish";
  entry: number;
  stop: number;
  target: number;
  requiredTarget: number;
  maxStop: number | null;
  targetGap: number;
  reward: number;
  geometry?: Pick<ScenarioGeometrySource, "target1" | "target2" | "structuralStop">;
}): string[] {
  const out: string[] = [];
  const structural = args.geometry?.structuralStop;
  const t2 = args.geometry?.target2 ?? args.geometry?.target1;

  if (args.targetGap > args.reward * 1.35) {
    out.push("Extending target this far may exceed a realistic range for the current structure.");
  }

  if (t2 != null && Number.isFinite(t2)) {
    if (args.direction === "bearish" && args.requiredTarget < t2 * 0.998) {
      out.push("Required target sits beyond the reference T2 extension — avoid fantasy targets.");
    }
    if (args.direction === "bullish" && args.requiredTarget > t2 * 1.002) {
      out.push("Required target sits beyond the reference T2 extension — avoid fantasy targets.");
    }
  }

  if (args.maxStop != null) {
    const stopSpan = Math.abs(args.maxStop - args.entry);
    const pct = stopSpan / args.entry;
    if (pct < 0.002) {
      out.push("Tightening stop to the R:R threshold may place the stop inside noise relative to entry.");
    }
    if (structural != null && args.direction === "bearish" && args.maxStop < structural * 0.998) {
      out.push("Stop threshold is inside the structural reference — only tighten if price action confirms.");
    }
    if (structural != null && args.direction === "bullish" && args.maxStop > structural * 1.002) {
      out.push("Stop threshold is inside the structural reference — only tighten if price action confirms.");
    }
  }

  return out.slice(0, 3);
}

const QUALITY_ORDER: Record<ScenarioRrLeverQuality, number> = { best: 0, medium: 1, risky: 2 };

export function buildScenarioRrFixGuidance(
  levels: Pick<ResolvedScenarioLevels, "entry" | "stop" | "target" | "riskReward">,
  direction: "bullish" | "bearish",
  geometry?: Pick<ScenarioGeometrySource, "target1" | "target2" | "structuralStop" | "entryZoneLow" | "entryZoneHigh">,
  minRr: number = SCENARIO_RR_MIN
): ScenarioRrFixGuidance | null {
  const { entry, stop, target, riskReward } = levels;
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(target) || !Number.isFinite(minRr)) {
    return null;
  }
  if (riskReward >= minRr) return null;

  const parts = riskRewardParts(entry, stop, target, direction);
  if (!parts) return null;

  const reqTarget = requiredTargetAtMinRr(entry, stop, direction, minRr);
  const maxStop = stopThresholdForRr(entry, target, direction, minRr);
  const minEntry = entryThresholdForRr(stop, target, direction, minRr);
  if (reqTarget == null) return null;

  const requiredReward = round4(minRr * parts.risk);
  const targetGap =
    direction === "bearish"
      ? Math.max(0, round4(target - reqTarget))
      : Math.max(0, round4(reqTarget - target));

  const bottleneck = inferBottleneck(parts.risk, parts.reward, targetGap, minRr);
  const diagnosis = diagnosisForBottleneck(bottleneck, direction);

  const entryOp = direction === "bullish" ? "≤" : "≥";
  const stopOp = direction === "bullish" ? "≥" : "≤";
  const targetOp = direction === "bullish" ? "≥" : "≤";

  const levers: ScenarioRrFixLever[] = [];

  if (minEntry != null) {
    const entryDetail =
      direction === "bullish"
        ? "Wait for a pullback / better fill in the zone before entry."
        : "Wait for a rally toward resistance / better short fill before entry.";
    levers.push({
      id: "entry",
      quality: "best",
      label: "Improve entry timing",
      thresholdText: `Entry ${entryOp} ${minEntry.toFixed(2)}`,
      detail: entryDetail,
      calcLine: `(${stop.toFixed(2)}×2 + ${target.toFixed(2)}) ÷ 3`
    });
  }

  if (maxStop != null) {
    const stopDetail =
      direction === "bullish"
        ? "Raise stop toward entry only if structure / VWAP still supports the level."
        : "Lower stop toward entry only if structure still supports the level.";
    levers.push({
      id: "stop",
      quality: "medium",
      label: "Tighten stop (structure permitting)",
      thresholdText: `Stop ${stopOp} ${maxStop.toFixed(2)}`,
      detail: stopDetail,
      calcLine: `${entry.toFixed(2)} ${direction === "bullish" ? "−" : "+"} (${(parts.reward / minRr).toFixed(2)})`
    });
  }

  const targetDetail =
    targetGap > 0
      ? `~$${targetGap.toFixed(2)} further ${direction === "bearish" ? "down" : "up"} vs current target.`
      : "Target already near the threshold — small extension may suffice.";
  levers.push({
    id: "target",
    quality: "risky",
    label: "Extend target",
    thresholdText: `Target ${targetOp} ${reqTarget.toFixed(2)}`,
    detail: targetDetail,
    calcLine: `${entry.toFixed(2)} ${direction === "bullish" ? "+" : "−"} ${minRr.toFixed(1)} × ${parts.risk.toFixed(2)}`
  });

  levers.sort((a, b) => QUALITY_ORDER[a.quality] - QUALITY_ORDER[b.quality]);

  const warnings = buildWarnings({
    direction,
    entry,
    stop,
    target,
    requiredTarget: reqTarget,
    maxStop,
    targetGap,
    reward: parts.reward,
    geometry
  });

  return {
    direction,
    entry: round4(entry),
    stop: round4(stop),
    target: round4(target),
    riskPerShare: parts.risk,
    rewardPerShare: parts.reward,
    riskReward: round4(riskReward),
    minRr,
    requiredReward,
    targetExtensionGap: targetGap,
    diagnosis,
    primaryBottleneck: bottleneck,
    levers,
    warnings
  };
}

/** @deprecated Prefer buildScenarioRrFixGuidance — kept for quick-calc tests. */
export function formatScenarioRrQuickCalcFromFix(g: ScenarioRrFixGuidance): string {
  const targetLever = g.levers.find((l) => l.id === "target");
  return targetLever?.calcLine ?? "";
}
