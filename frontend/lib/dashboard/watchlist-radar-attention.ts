/**
 * Watchlist radar attention sublines — separate setup quality (layers) from desk/regime gating.
 */

import type { AlignmentDisplayTier } from "@/lib/alignment-display-tier";
import { regimeBlocksDesk } from "@/lib/scanner/scanner-quiet-desk";
import type { WatchlistAttentionTier } from "@/lib/watchlist-decision-card-present";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

export type WatchlistRadarDeskContext = {
  regimeLabel: string;
  /** Dashboard system banner suppressed (no desk setups firing). */
  systemSuppressed: boolean;
};

/** Default when regime/desk context is not loaded (neutral, desk open). */
export const WATCHLIST_DESK_OPEN: WatchlistRadarDeskContext = {
  regimeLabel: "Neutral",
  systemSuppressed: false
};

export type WatchlistRadarAttentionInput = {
  tier: WatchlistAttentionTier;
  row: WatchlistMaturationRow | undefined;
  alignmentTier: AlignmentDisplayTier;
  blockers: string[];
  desk: WatchlistRadarDeskContext;
};

function isFullyAligned(input: WatchlistRadarAttentionInput): boolean {
  if (input.row?.progress_band === "actionable") return true;
  return input.alignmentTier === "actionable";
}

function isNearReadyBand(input: WatchlistRadarAttentionInput): boolean {
  if (input.row?.progress_band === "near_ready") return true;
  return input.alignmentTier === "near_ready";
}

export function formatRegimeGateQualifier(regimeLabel: string): string | null {
  const r = regimeLabel.trim().toLowerCase();
  if (!r || r === "neutral") return null;
  return `${r} regime`;
}

/** Desk-level or bearish-regime gate (not per-symbol layer gaps). */
export function isWatchlistRadarDeskGated(desk: WatchlistRadarDeskContext): boolean {
  return desk.systemSuppressed || regimeBlocksDesk(desk.regimeLabel);
}

function deskGatedPhrase(desk: WatchlistRadarDeskContext, prefix: string): string {
  const qualifier = formatRegimeGateQualifier(desk.regimeLabel);
  return qualifier ? `${prefix} — desk gated (${qualifier})` : `${prefix} — desk gated`;
}

function symbolHoldPhrase(blockers: string[]): string | null {
  const labels = blockers.filter((b) => b !== "Macro").slice(0, 2);
  if (labels.length === 0) return null;
  return labels.length === 1
    ? `Strong setup — ${labels[0]} on Signals`
    : `Strong setup — ${labels.join(" · ")} on Signals`;
}

/**
 * User-facing subline under alignment (e.g. "Strong (6/6)").
 * Distinguishes "signal ready, market isn't" from "still building layers".
 */
export function resolveWatchlistRadarAttentionLine(input: WatchlistRadarAttentionInput): string | null {
  const { tier, blockers, desk } = input;

  if (tier === "check_now") {
    if (isFullyAligned(input)) {
      if (isWatchlistRadarDeskGated(desk)) {
        return deskGatedPhrase(desk, "Strong setup");
      }
      const macroOnly =
        blockers.includes("Macro") && blockers.filter((b) => b !== "Macro").length === 0;
      if (macroOnly) {
        return "Strong setup — macro gate on Signals";
      }
      const hold = symbolHoldPhrase(blockers);
      if (hold) return hold;
      return "Strong on your list — open on Signals";
    }
    if (isNearReadyBand(input)) {
      if (isWatchlistRadarDeskGated(desk)) {
        return deskGatedPhrase(desk, "Near ready");
      }
      return "Near actionable on your list";
    }
    return "Worth opening on Signals";
  }

  if (tier === "getting_close") return "Building on your watchlist";
  return null;
}
