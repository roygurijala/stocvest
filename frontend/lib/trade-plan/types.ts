/**
 * Tracked trade plan — frozen snapshot when the user commits to working a setup.
 * Stored in browser localStorage only (planning; not a broker order).
 */

export type TrackedPlanMode = "swing" | "day";

export type TrackedPlanBias = "Bullish" | "Bearish" | "Neutral";

export interface TrackedPlanLevels {
  entryLow: number;
  entryHigh: number;
  stop: number;
  target1: number;
  target2?: number | null;
  priceAtCommit: number;
  riskRewardAtCommit?: number | null;
}

export interface TrackedPlan {
  id: string;
  symbol: string;
  mode: TrackedPlanMode;
  committedAt: string;
  expiresAt?: string | null;
  bias: TrackedPlanBias;
  layersAligned?: number | null;
  layersTotal?: number | null;
  levels: TrackedPlanLevels;
  entryZoneQuality?: string | null;
  parameterVersion?: string | null;
  verdictLine?: string | null;
  deskMinRr?: number | null;
}

export interface LivePlanAssessment {
  currentPrice: number | null;
  setupBias: TrackedPlanBias;
  decisionState: "actionable" | "monitor" | "blocked" | null;
  executionActionable: boolean | null;
  entryZoneQuality: string | null;
  inEntryZone: boolean;
  currentRr: number | null;
  isInsufficient: boolean;
  layersAligned?: number | null;
  layersTotal?: number | null;
}
