/**
 * Position-desk reference stop — wider weekly ATR floors (ADR-004 POS-D5).
 * Python twin: `stocvest/api/services/position_reference_stop_policy.py`
 */

import {
  formatMergedStopProvenance,
  resolveMergedReferenceStop,
  resolveStructuralStopAnchor,
  type MergedReferenceStopResult,
  type StructuralStopAnchorInput
} from "@/lib/scenario/reference-stop-resolve";
import type { ScenarioDirection } from "@/lib/scenario/types";

export const POSITION_STOP_ATR_K = 3.0;
export const POSITION_MIN_STOP_ATR_MULT = 2.0;
export const POSITION_MIN_STOP_PCT = 0.1;
export const MIN_POSITION_STOP_DISTANCE_ATR = 2.0;
export const MIN_POSITION_RR = 1.5;
export const POSITION_T2_ATR_BETA = 5.0;

export type PositionReferenceStopTradingMode = "position";

export function positionReferenceStopAtrK(): number {
  return POSITION_STOP_ATR_K;
}

export function resolvePositionMergedReferenceStop(args: {
  direction: ScenarioDirection;
  entry: number;
  structuralStop: number | null;
  atr: number | null;
  atrK?: number | null;
}): MergedReferenceStopResult {
  return resolveMergedReferenceStop({
    direction: args.direction,
    entry: args.entry,
    structuralStop: args.structuralStop,
    atr: args.atr,
    atrK: args.atrK ?? POSITION_STOP_ATR_K,
    tradingMode: "position"
  });
}

export {
  formatMergedStopProvenance,
  resolveStructuralStopAnchor,
  type StructuralStopAnchorInput
};
