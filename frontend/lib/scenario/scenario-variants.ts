/**
 * Controlled reference-scenario variants for Signals (what-if only).
 *
 * Does NOT mutate composite API data, ledger eligibility, or authoritative
 * trade decision — only local presentation on the Signals page.
 */

import { resolveAlignmentDisplayTier } from "@/lib/alignment-display-tier";
import type { SignalsSetupBias } from "@/lib/signals-page-present";
import { referenceLevelsFromSessionStructure } from "@/lib/signal-evidence";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";

/** Matches `buildSignalsPageDecision` R/R gate — keep in sync. */
export const SCENARIO_RR_MIN = 2.0;

export type ScenarioEntryStyle = "mid_zone" | "aggressive" | "conservative";
export type ScenarioStopStrategy = "structural" | "tight" | "vwap";
export type ScenarioTargetChoice = "t1" | "t2";
export type ScenarioPresetId = "default" | "conservative" | "aggressive";

export type ScenarioGeometrySource = {
  direction: "bullish" | "bearish";
  entryZoneLow: number | null;
  entryZoneHigh: number | null;
  last: number | null;
  structuralStop: number | null;
  target1: number | null;
  target2: number | null;
  vwap: number | null;
  systemRiskReward: number | null;
};

export type ScenarioGeometryPrecision = "validated" | "estimated";

export type ScenarioLevelProvenance = {
  entry: "zone" | "last" | "synthetic_zone" | "estimated";
  stop: "composite" | "structure" | "vwap" | "percent_rule" | "estimated";
  target: "composite" | "structure" | "percent_rule" | "estimated";
};

export type ScenarioGeometryBundle = {
  source: ScenarioGeometrySource;
  precision: ScenarioGeometryPrecision;
  provenance: ScenarioLevelProvenance;
  estimationLines: string[];
};

export type ScenarioSelection = {
  preset: ScenarioPresetId;
  entry: ScenarioEntryStyle;
  stop: ScenarioStopStrategy;
  target: ScenarioTargetChoice;
};

export type ResolvedScenarioLevels = {
  entry: number;
  stop: number;
  target: number;
  riskReward: number;
};

export type ScenarioVariantCatalog = {
  source: ScenarioGeometrySource;
  system: ResolvedScenarioLevels | null;
  presets: Record<ScenarioPresetId, ScenarioSelection>;
  defaultSelection: ScenarioSelection;
};

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function entryMid(last: number | null, lo: number | null, hi: number | null): number | null {
  if (last != null && last > 0) return last;
  if (lo != null && hi != null && hi > lo) return (lo + hi) / 2;
  return null;
}

function rrLong(entry: number, target: number, stop: number): number | null {
  const risk = entry - stop;
  const reward = target - entry;
  if (risk <= 1e-6 || reward <= 1e-6) return null;
  return round4(reward / risk);
}

function rrShort(entry: number, target: number, stop: number): number | null {
  const risk = stop - entry;
  const reward = entry - target;
  if (risk <= 1e-6 || reward <= 1e-6) return null;
  return round4(reward / risk);
}

function resolveEntry(
  style: ScenarioEntryStyle,
  direction: "bullish" | "bearish",
  last: number | null,
  lo: number | null,
  hi: number | null
): number | null {
  const mid = entryMid(last, lo, hi);
  if (mid == null) return null;
  if (style === "mid_zone") return round4(mid);
  if (direction === "bullish") {
    if (style === "aggressive") {
      if (lo != null && lo > 0) return round4(lo);
      return round4(mid * 0.998);
    }
    if (hi != null && hi > 0) return round4(hi);
    return round4(mid);
  }
  if (style === "aggressive") {
    if (hi != null && hi > 0) return round4(hi);
    return round4(mid * 1.002);
  }
  if (lo != null && lo > 0) return round4(lo);
  return round4(mid);
}

function resolveStop(
  strategy: ScenarioStopStrategy,
  direction: "bullish" | "bearish",
  entry: number,
  structural: number | null,
  vwap: number | null
): number | null {
  if (structural == null || !Number.isFinite(structural)) return null;
  const base = structural;
  if (strategy === "structural") return round4(base);
  if (strategy === "vwap" && vwap != null && vwap > 0) {
    const vStop = direction === "bullish" ? round4(vwap * 0.995) : round4(vwap * 1.005);
    if (direction === "bullish" && vStop < entry) return vStop;
    if (direction === "bearish" && vStop > entry) return vStop;
    return round4(base);
  }
  if (strategy === "tight") {
    if (direction === "bullish" && base < entry) {
      return round4(base + (entry - base) * 0.35);
    }
    if (direction === "bearish" && base > entry) {
      return round4(base - (base - entry) * 0.35);
    }
  }
  return round4(base);
}

function resolveTarget(
  choice: ScenarioTargetChoice,
  direction: "bullish" | "bearish",
  entry: number,
  t1: number | null,
  t2: number | null
): number | null {
  const primary = t1;
  const extended = t2 ?? (primary != null ? round4(direction === "bullish" ? primary * 1.004 : primary * 0.996) : null);
  const pick = choice === "t2" ? extended : primary;
  if (pick == null || !Number.isFinite(pick)) return null;
  if (direction === "bullish" && pick <= entry) return null;
  if (direction === "bearish" && pick >= entry) return null;
  return round4(pick);
}

export function resolveScenarioLevels(
  source: ScenarioGeometrySource,
  selection: ScenarioSelection
): ResolvedScenarioLevels | null {
  const entry = resolveEntry(
    selection.entry,
    source.direction,
    source.last,
    source.entryZoneLow,
    source.entryZoneHigh
  );
  if (entry == null) return null;
  const stop = resolveStop(
    selection.stop,
    source.direction,
    entry,
    source.structuralStop,
    source.vwap
  );
  if (stop == null) return null;
  const target = resolveTarget(
    selection.target,
    source.direction,
    entry,
    source.target1,
    source.target2
  );
  if (target == null) return null;
  const rr =
    source.direction === "bullish"
      ? rrLong(entry, target, stop)
      : rrShort(entry, target, stop);
  if (rr == null || !Number.isFinite(rr)) return null;
  return { entry, stop, target, riskReward: rr };
}

export function setupBiasToScenarioDirection(
  bias: SignalsSetupBias
): ScenarioGeometrySource["direction"] | null {
  if (bias === "Bullish") return "bullish";
  if (bias === "Bearish") return "bearish";
  return null;
}

export function buildScenarioGeometrySource(args: {
  bias: SignalsSetupBias;
  entryZoneLow?: number | null;
  entryZoneHigh?: number | null;
  last?: number | null;
  structuralStop?: number | null;
  target1?: number | null;
  target2?: number | null;
  vwap?: number | null;
  systemRiskReward?: number | null;
}): ScenarioGeometrySource | null {
  const direction = setupBiasToScenarioDirection(args.bias);
  if (!direction) return null;
  return {
    direction,
    entryZoneLow: args.entryZoneLow ?? null,
    entryZoneHigh: args.entryZoneHigh ?? null,
    last: args.last ?? null,
    structuralStop: args.structuralStop ?? null,
    target1: args.target1 ?? null,
    target2: args.target2 ?? null,
    vwap: args.vwap ?? null,
    systemRiskReward: args.systemRiskReward ?? null
  };
}

function positivePrice(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function pctFallbackStop(direction: "bullish" | "bearish", entry: number): number {
  return direction === "bullish" ? round4(entry * 0.985) : round4(entry * 1.015);
}

function pctFallbackTarget(direction: "bullish" | "bearish", entry: number): number {
  return direction === "bullish" ? round4(entry * 1.012) : round4(entry * 0.988);
}

/** Developing+ only — hide Neutral bias and not_aligned / invalidated. */
export function isExecutionStageEligibleForScenarioAdjust(args: {
  maturationState?: string | null;
  layersAligned?: number;
  layersTotal?: number;
}): boolean {
  const tier = resolveAlignmentDisplayTier({
    layersAligned: args.layersAligned ?? 0,
    layersTotal: args.layersTotal ?? 6,
    maturationState: args.maturationState
  });
  return tier !== "not_aligned" && tier !== "invalidated";
}

export function formatScenarioEstimationLines(provenance: ScenarioLevelProvenance): string[] {
  const lines: string[] = [];
  if (provenance.entry === "last") lines.push("Entry: current price");
  else if (provenance.entry === "zone") lines.push("Entry: reference zone");
  else if (provenance.entry === "synthetic_zone") lines.push("Entry: estimated band around last price");
  if (provenance.stop === "composite") lines.push("Stop: system reference stop");
  else if (provenance.stop === "structure") lines.push("Stop: recent session structure");
  else if (provenance.stop === "vwap") lines.push("Stop: VWAP-based");
  else if (provenance.stop === "percent_rule") lines.push("Stop: percent rule from entry");
  if (provenance.target === "composite") lines.push("Target: system reference target");
  else if (provenance.target === "structure") {
    lines.push("Target: nearest resistance/support from session");
  } else if (provenance.target === "percent_rule") {
    lines.push("Target: percent extension from entry");
  }
  return lines;
}

export type BuildScenarioGeometryBundleArgs = {
  bias: SignalsSetupBias;
  maturationState?: string | null;
  layersAligned?: number;
  layersTotal?: number;
  entryZoneLow?: number | null;
  entryZoneHigh?: number | null;
  last?: number | null;
  structuralStop?: number | null;
  target1?: number | null;
  target2?: number | null;
  vwap?: number | null;
  support?: number | null;
  resistance?: number | null;
  prevClose?: number | null;
  systemRiskReward?: number | null;
  /** True when stop/target came from composite insight fields. */
  compositeStopProvided?: boolean;
  compositeTargetProvided?: boolean;
  compositeZoneProvided?: boolean;
};

/**
 * Build geometry with fallbacks — returns null only for Neutral bias, early/invalidated
 * stage, or when no price structure exists at all.
 */
export function buildScenarioGeometryBundle(
  args: BuildScenarioGeometryBundleArgs
): ScenarioGeometryBundle | null {
  const direction = setupBiasToScenarioDirection(args.bias);
  if (!direction) return null;
  if (
    !isExecutionStageEligibleForScenarioAdjust({
      maturationState: args.maturationState,
      layersAligned: args.layersAligned,
      layersTotal: args.layersTotal
    })
  ) {
    return null;
  }

  const provenance: ScenarioLevelProvenance = {
    entry: "estimated",
    stop: "estimated",
    target: "estimated"
  };

  let last = positivePrice(args.last);
  let zoneLo = positivePrice(args.entryZoneLow);
  let zoneHi = positivePrice(args.entryZoneHigh);
  let vwap = positivePrice(args.vwap);
  let stop = positivePrice(args.structuralStop);
  let t1 = positivePrice(args.target1);
  let t2 = positivePrice(args.target2);

  if (args.compositeZoneProvided && zoneLo != null && zoneHi != null) {
    provenance.entry = "zone";
  } else if (last != null) {
    provenance.entry = "last";
  }

  if (args.compositeStopProvided && stop != null) provenance.stop = "composite";
  if (args.compositeTargetProvided && t1 != null) provenance.target = "composite";

  if (last == null && zoneLo != null && zoneHi != null && zoneHi > zoneLo) {
    last = round4((zoneLo + zoneHi) / 2);
    provenance.entry = "zone";
  }
  if (last == null) return null;

  if (zoneLo == null || zoneHi == null || zoneHi <= zoneLo) {
    zoneLo = round4(last * 0.998);
    zoneHi = round4(last * 1.002);
    if (provenance.entry === "last") provenance.entry = "synthetic_zone";
  }

  const support = positivePrice(args.support);
  const resistance = positivePrice(args.resistance);
  const session = referenceLevelsFromSessionStructure({
    direction,
    support,
    resistance,
    vwap,
    lastTradePrice: last,
    prevClose: positivePrice(args.prevClose)
  });

  if (stop == null && session.reference_stop_level != null) {
    stop = session.reference_stop_level;
    provenance.stop = "structure";
  }
  if (t1 == null && session.reference_target_1 != null) {
    t1 = session.reference_target_1;
    if (provenance.target !== "composite") provenance.target = "structure";
  }
  if (t2 == null && session.reference_target_2 != null) {
    t2 = session.reference_target_2;
  }

  if (stop == null) {
    stop = pctFallbackStop(direction, last);
    provenance.stop = "percent_rule";
  }
  if (t1 == null) {
    t1 = pctFallbackTarget(direction, last);
    provenance.target = "percent_rule";
  }

  const source: ScenarioGeometrySource = {
    direction,
    entryZoneLow: zoneLo,
    entryZoneHigh: zoneHi,
    last,
    structuralStop: stop,
    target1: t1,
    target2: t2,
    vwap,
    systemRiskReward: args.systemRiskReward ?? null
  };

  const catalog = buildScenarioVariantCatalog(source);
  if (!catalog) return null;

  const precision: ScenarioGeometryPrecision =
    provenance.entry === "zone" &&
    provenance.stop === "composite" &&
    provenance.target === "composite"
      ? "validated"
      : "estimated";

  const estimationLines =
    precision === "estimated"
      ? [
          ...formatScenarioEstimationLines(provenance),
          "Refine when full scenario levels are available from composite"
        ]
      : [];

  return { source, precision, provenance, estimationLines };
}

const PRESET_SELECTIONS: Record<ScenarioPresetId, ScenarioSelection> = {
  default: { preset: "default", entry: "mid_zone", stop: "structural", target: "t1" },
  conservative: { preset: "conservative", entry: "conservative", stop: "structural", target: "t1" },
  aggressive: { preset: "aggressive", entry: "aggressive", stop: "tight", target: "t2" }
};

export function buildScenarioVariantCatalog(source: ScenarioGeometrySource): ScenarioVariantCatalog | null {
  const system = resolveScenarioLevels(source, PRESET_SELECTIONS.default);
  if (!system) return null;
  return {
    source,
    system,
    presets: PRESET_SELECTIONS,
    defaultSelection: PRESET_SELECTIONS.default
  };
}

export function scenarioClearsRrGate(riskReward: number): boolean {
  return Number.isFinite(riskReward) && riskReward >= SCENARIO_RR_MIN;
}

export function formatScenarioRatio(riskReward: number): string {
  return `${riskReward.toFixed(1)} : 1`;
}

export type ScenarioImpactLine = { label: string; detail: string };

export function explainScenarioImpact(
  before: ResolvedScenarioLevels,
  after: ResolvedScenarioLevels,
  selection: ScenarioSelection
): ScenarioImpactLine[] {
  const lines: ScenarioImpactLine[] = [];
  const entryDelta = after.entry - before.entry;
  const stopDelta = after.stop - before.stop;
  const targetDelta = after.target - before.target;
  const bullish = after.entry < after.target;

  if (Math.abs(entryDelta) > 1e-4) {
    if (selection.entry === "aggressive") {
      lines.push({
        label: bullish ? "Lower entry" : "Higher entry",
        detail: "improved upside room on this side"
      });
    } else if (selection.entry === "conservative") {
      lines.push({
        label: bullish ? "Higher entry" : "Lower entry",
        detail: "breakout-style entry — less upside per share"
      });
    }
  }
  if (Math.abs(targetDelta) > 1e-4 && selection.target === "t2") {
    lines.push({
      label: "Extended target",
      detail: "increased reward at reference resistance/support"
    });
  }
  if (Math.abs(stopDelta) > 1e-4 && (selection.stop === "tight" || selection.stop === "vwap")) {
    lines.push({
      label: selection.stop === "tight" ? "Tighter stop" : "VWAP-based stop",
      detail: "reduced per-share risk vs structural stop"
    });
  }
  if (after.riskReward > before.riskReward + 0.05) {
    lines.push({
      label: "Risk/reward improved",
      detail: `${formatScenarioRatio(before.riskReward)} → ${formatScenarioRatio(after.riskReward)}`
    });
  } else if (after.riskReward < before.riskReward - 0.05) {
    lines.push({
      label: "Risk/reward reduced",
      detail: `${formatScenarioRatio(before.riskReward)} → ${formatScenarioRatio(after.riskReward)}`
    });
  }
  return lines.slice(0, 4);
}

/** Non-authoritative blockers still applying after scenario clears R/R only. */
export function remainingBlockersAfterScenarioRr(
  systemDecision: TradeDecision,
  scenarioClearsRr: boolean
): string[] {
  const out: string[] = [];
  const isRrText = (t: string) => /risk\s*\/?\s*reward|r\/r/i.test(t);

  if (systemDecision.rationale?.text) {
    const isRrCat = systemDecision.rationale.category === "risk_reward";
    if (!(scenarioClearsRr && isRrCat)) {
      if (!out.includes(systemDecision.rationale.text)) out.push(systemDecision.rationale.text);
    }
  }
  for (const line of systemDecision.reinforcements) {
    if (scenarioClearsRr && isRrText(line)) continue;
    if (!out.includes(line)) out.push(line);
  }
  return out.slice(0, 3);
}

export function scenarioExecutionSummary(args: {
  systemDecision: TradeDecision;
  scenarioRr: number;
  scenarioClearsRr: boolean;
}): { headline: string; subline: string | null } {
  if (args.systemDecision.state === "actionable") {
    return {
      headline: "System already actionable — scenario is for comparison only",
      subline: `Reference scenario R/R ${formatScenarioRatio(args.scenarioRr)}`
    };
  }
  if (args.scenarioClearsRr) {
    return {
      headline: "Scenario would clear the risk/reward gate",
      subline: "System verdict unchanged — alignment and other gates still apply"
    };
  }
  return {
    headline: "Scenario still below risk/reward minimum",
    subline: `Needs at least ${SCENARIO_RR_MIN.toFixed(1)} : 1 for that gate alone`
  };
}

/** Bar fill 0–1 for reward share of risk+reward (visual only). */
export function scenarioRrBarFills(riskReward: number): { risk: number; reward: number } {
  if (!Number.isFinite(riskReward) || riskReward <= 0) return { risk: 0.5, reward: 0.5 };
  const reward = riskReward / (riskReward + 1);
  return { risk: 1 - reward, reward };
}

export function scenarioRrTone(riskReward: number): "low" | "ok" | "strong" {
  if (riskReward < SCENARIO_RR_MIN) return "low";
  if (riskReward < 3) return "ok";
  return "strong";
}
