/**
 * Watchlist radar attention sublines — separate setup quality (layers) from desk/regime gating.
 */

import type { AlignmentDisplayTier } from "@/lib/alignment-display-tier";
import type { SessionActivityUiMode } from "@/lib/market/session-activity-mode";
import { regimeBlocksDesk } from "@/lib/scanner/scanner-quiet-desk";
import type { WatchlistAttentionTier } from "@/lib/watchlist-decision-card-present";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import {
  isExplicitNeutralMaturationBias,
  WATCHLIST_BALANCED_NO_EDGE_LINE,
  watchlistSetupQualityPrefix
} from "@/lib/watchlist-maturation-bias-present";

export type WatchlistRadarDeskContext = {
  regimeLabel: string;
  /** Dashboard system banner suppressed (no desk setups firing). */
  systemSuppressed: boolean;
  /** Regular session not open — matches Watchlists maturation copy and pipeline session mode. */
  sessionMode?: SessionActivityUiMode;
};

/** Default when regime/desk context is not loaded (neutral, desk open). */
export const WATCHLIST_DESK_OPEN: WatchlistRadarDeskContext = {
  regimeLabel: "Neutral",
  systemSuppressed: false,
  sessionMode: "live"
};

export type WatchlistRadarAttentionInput = {
  tier: WatchlistAttentionTier;
  row: WatchlistMaturationRow | undefined;
  alignmentTier: AlignmentDisplayTier;
  blockers: string[];
  desk: WatchlistRadarDeskContext;
  /** Omit "— session closed" when the page/pipeline header already states it (card surfaces). */
  omitSessionClosedSuffix?: boolean;
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

/** Bearish (or other blocking) regime — affects card chrome and copy. */
export function isWatchlistRadarRegimeGated(desk: WatchlistRadarDeskContext): boolean {
  return regimeBlocksDesk(desk.regimeLabel);
}

/** Desk-level gate for attention copy (quiet desk + regime). */
export function isWatchlistRadarDeskGated(desk: WatchlistRadarDeskContext): boolean {
  return desk.systemSuppressed || isWatchlistRadarRegimeGated(desk);
}

/** Short label for tier previews (e.g. "2 held — quiet market today"). */
export function watchlistMarketHoldShortLabel(desk: WatchlistRadarDeskContext): string {
  if (isWatchlistRadarRegimeGated(desk)) {
    const regime = desk.regimeLabel.trim().toLowerCase();
    if (regime === "bearish") return "bearish market";
    if (regime) return `${regime} market`;
    return "cautious market";
  }
  if (desk.systemSuppressed) return "quiet market today";
  return "market on hold";
}

function watchlistMarketHoldPhrase(desk: WatchlistRadarDeskContext, prefix: string): string {
  return `${prefix} — ${watchlistMarketHoldShortLabel(desk)}`;
}

function sessionGatePhrase(
  prefix: string,
  sessionMode: SessionActivityUiMode | undefined,
  omitSessionClosedSuffix?: boolean
): string | null {
  if (omitSessionClosedSuffix) return null;
  if (sessionMode === "closed") return `${prefix} — session closed`;
  if (sessionMode === "extended") return `${prefix} — extended hours (context only)`;
  return null;
}

function symbolHoldPhrase(blockers: string[], bias: string | undefined): string | null {
  const labels = blockers.filter((b) => b !== "Macro").slice(0, 2);
  if (labels.length === 0) return null;
  const prefix = watchlistSetupQualityPrefix(bias);
  return labels.length === 1
    ? `${prefix} — ${labels[0]} on Signals`
    : `${prefix} — ${labels.join(" · ")} on Signals`;
}

/**
 * User-facing subline under alignment (e.g. "Strong (6/6)").
 * Distinguishes "signal ready, market isn't" from "still building layers".
 */
export function resolveWatchlistRadarAttentionLine(input: WatchlistRadarAttentionInput): string | null {
  const { tier, blockers, desk, row, omitSessionClosedSuffix } = input;
  const bias = row?.bias;
  const setupPrefix = watchlistSetupQualityPrefix(bias);
  const sessionClosedOrExtended =
    desk.sessionMode === "closed" || desk.sessionMode === "extended";

  if (tier === "check_now") {
    if (isFullyAligned(input)) {
      if (isExplicitNeutralMaturationBias(bias)) {
        const sessionPhrase = sessionGatePhrase("Balanced", desk.sessionMode, omitSessionClosedSuffix);
        if (sessionPhrase) return sessionPhrase;
        if (isWatchlistRadarDeskGated(desk)) {
          return watchlistMarketHoldPhrase(desk, "Balanced");
        }
        if (blockers.length > 0) {
          const hold = symbolHoldPhrase(blockers, bias);
          if (hold) return hold;
        }
        return WATCHLIST_BALANCED_NO_EDGE_LINE;
      }
      const sessionPhrase = sessionGatePhrase(setupPrefix, desk.sessionMode, omitSessionClosedSuffix);
      if (sessionPhrase) return sessionPhrase;
      if (isWatchlistRadarDeskGated(desk)) {
        return watchlistMarketHoldPhrase(desk, setupPrefix);
      }
      const macroOnly =
        blockers.includes("Macro") && blockers.filter((b) => b !== "Macro").length === 0;
      if (macroOnly) {
        return `${setupPrefix} — macro gate on Signals`;
      }
      const hold = symbolHoldPhrase(blockers, bias);
      if (hold) return hold;
      if (omitSessionClosedSuffix && sessionClosedOrExtended) {
        return setupPrefix;
      }
      return "Strong on your list — open on Signals";
    }
    if (isNearReadyBand(input)) {
      const sessionPhrase = sessionGatePhrase("Near ready", desk.sessionMode, omitSessionClosedSuffix);
      if (sessionPhrase) return sessionPhrase;
      if (isWatchlistRadarDeskGated(desk)) {
        return watchlistMarketHoldPhrase(desk, "Near ready");
      }
      if (omitSessionClosedSuffix && sessionClosedOrExtended) {
        return "Near ready";
      }
      return "Near actionable on your list";
    }
    return "Worth opening on Signals";
  }

  if (tier === "getting_close") return "Building on your watchlist";
  return null;
}
