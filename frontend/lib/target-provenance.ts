/**
 * T2 target provenance — gate eligibility for headline R/R.
 * Keep in sync with `stocvest/api/services/target_provenance.py`.
 */

export type Target2Provenance =
  | "2r_extension"
  | "t1_bump"
  | "resistance"
  | "atr_extension"
  | "analyst_target";

export function parseTarget2Provenance(raw: unknown): Target2Provenance | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (
    v === "2r_extension" ||
    v === "t1_bump" ||
    v === "resistance" ||
    v === "atr_extension" ||
    v === "analyst_target"
  )
    return v;
  return null;
}

export function target2EligibleForGate(provenance: Target2Provenance | null | undefined): boolean {
  return provenance === "resistance";
}

export function target2ProvenanceLabel(
  provenance: Target2Provenance | null | undefined,
  direction: "bullish" | "bearish" = "bullish"
): string | null {
  if (provenance === "2r_extension") return "2R projection — unanchored";
  if (provenance === "atr_extension") return "ATR projection — unanchored";
  if (provenance === "t1_bump") return "T1 bump — unanchored";
  if (provenance === "analyst_target") return "Analyst-target-implied — not structural";
  // The "resistance" token means "anchored at a real structural level" regardless of
  // side; for a short the downside T2 is anchored to *support*, so the label flips.
  if (provenance === "resistance") return direction === "bearish" ? "Support-anchored" : "Resistance-anchored";
  return null;
}

/** User's chosen target is effectively T2 when it matches composite T2 within tick tolerance. */
export function targetMatchesT2(
  target: number,
  target2: number | null | undefined,
  tick = 0.02
): boolean {
  if (target2 == null || !Number.isFinite(target2)) return false;
  return Math.abs(target - target2) <= tick;
}

export type ScenarioGateEvaluation = {
  rr: number | null;
  clearsDeskRr: boolean;
  gateBlockReason: string | null;
  t1Rr: number | null;
  usesUnanchoredT2: boolean;
};

export function evaluateScenarioDeskGate(args: {
  direction: "bullish" | "bearish";
  entry: number;
  stop: number;
  target: number;
  target1: number | null;
  target2: number | null;
  target2Provenance: Target2Provenance | null;
  deskMinRr: number;
}): ScenarioGateEvaluation {
  const rrFrom = (t: number): number | null => {
    if (args.direction === "bullish") {
      const risk = args.entry - args.stop;
      const reward = t - args.entry;
      if (risk <= 1e-6 || reward <= 1e-6) return null;
      return Math.round((reward / risk) * 10000) / 10000;
    }
    const risk = args.stop - args.entry;
    const reward = args.entry - t;
    if (risk <= 1e-6 || reward <= 1e-6) return null;
    return Math.round((reward / risk) * 10000) / 10000;
  };

  const t1Rr = args.target1 != null ? rrFrom(args.target1) : null;
  const scenarioRr = rrFrom(args.target);
  const usesUnanchoredT2 =
    targetMatchesT2(args.target, args.target2) && !target2EligibleForGate(args.target2Provenance);

  if (usesUnanchoredT2) {
    return {
      rr: scenarioRr,
      clearsDeskRr: false,
      gateBlockReason: target2ProvenanceLabel(args.target2Provenance, args.direction) ?? "Extended target — unanchored",
      t1Rr,
      usesUnanchoredT2: true
    };
  }

  if (t1Rr != null && t1Rr < 1 && targetMatchesT2(args.target, args.target2)) {
    return {
      rr: scenarioRr,
      clearsDeskRr: false,
      gateBlockReason: `T1 too close to entry (${t1Rr.toFixed(1)}:1) — extended target not structurally anchored`,
      t1Rr,
      usesUnanchoredT2: false
    };
  }

  const clearsDeskRr = scenarioRr != null && scenarioRr >= args.deskMinRr;
  return {
    rr: scenarioRr,
    clearsDeskRr,
    gateBlockReason: clearsDeskRr ? null : `Below ${args.deskMinRr.toFixed(1)}:1 desk minimum`,
    t1Rr,
    usesUnanchoredT2: false
  };
}
