/**
 * Compact copy for Trading Room signal cards — explains why an "Actionable"
 * setup may still fail validation ledger gates under Layer 0 desk policy.
 */

import type { FeedLane, FeedState } from "@/lib/dashboard/trading-room/feed-model";
import type { MarketEnvironmentPayload } from "@/lib/signal-evidence/market-environment-present";

const NORMAL_MIN_RR_SWING = 2;
const NORMAL_MIN_RR_DAY = 1.3;

export function environmentTierSessionLabel(tier: MarketEnvironmentPayload["environment_tier"]): string {
  switch (tier) {
    case "crisis":
      return "CRISIS SESSION";
    case "stressed":
      return "STRESSED SESSION";
    case "elevated":
      return "ELEVATED SESSION";
    default:
      return "NORMAL SESSION";
  }
}

/**
 * One-line hint under actionable/near cards when VIX tier tightens ledger gates.
 * Returns null for normal sessions or cooler feed states.
 */
export function environmentSessionCardHint(
  environment: MarketEnvironmentPayload | null | undefined,
  lane: FeedLane,
  state: FeedState
): string | null {
  if (!environment || environment.environment_tier === "normal") return null;
  if (state !== "actionable" && state !== "near") return null;

  const tierLabel = environmentTierSessionLabel(environment.environment_tier);
  const newAllowed = lane === "day" ? environment.new_day_allowed : environment.new_swing_allowed;
  const baseline = lane === "day" ? NORMAL_MIN_RR_DAY : NORMAL_MIN_RR_SWING;

  if (!newAllowed) {
    return `${tierLabel} · New ${lane} validation entries paused`;
  }
  if (environment.min_rr > baseline + 0.05) {
    return `${tierLabel} · Minimum R/R raised to ${environment.min_rr.toFixed(1)}:1`;
  }
  return tierLabel;
}
