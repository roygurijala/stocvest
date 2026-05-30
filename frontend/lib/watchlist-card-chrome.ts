/**
 * Watchlist / dashboard progress card chrome — border colors, badges, direction chip.
 *
 * Border semantics (not the same as quote % green/red):
 * - Green: actionable, symbol gates cleared, desk allows execution for this mode
 * - Amber: near ready, blockers, desk/regime gated, day session closed, extended hours
 * - Red: invalidated only
 * - Muted: background tracking / early developing
 *
 * Direction chip (small pill): long/short — never confused with border red (failure).
 */

import { ACTIONABLE_ALIGNED_MIN, type AlignmentDisplayTier } from "@/lib/alignment-display-tier";
import { maturationAlignmentCounts } from "@/lib/watchlist-alignment-present";
import type { WatchlistRadarDeskContext } from "@/lib/dashboard/watchlist-radar-attention";
import { isWatchlistRadarDeskGated } from "@/lib/dashboard/watchlist-radar-attention";
import type { SessionActivityUiMode } from "@/lib/market/session-activity-mode";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import {
  isBalancedHighAlignment,
  isExplicitNeutralMaturationBias,
  normalizeMaturationBias
} from "@/lib/watchlist-maturation-bias-present";

export type WatchlistCardChromeKind =
  | "actionable_ready"
  | "actionable_plan"
  | "blocked"
  | "invalidated"
  | "tracking";

export type WatchlistCardThemeColors = {
  accent: string;
  bullish: string;
  bearish: string;
  caution: string;
  textMuted: string;
};

export type WatchlistDirectionChip = {
  label: string;
  color: string;
  background: string;
};

export type WatchlistCardChrome = {
  kind: WatchlistCardChromeKind;
  borderLeft: string;
  borderBottom: string;
  /** Layer dots accent — follows border tier, not quote %. */
  dotAccent: string;
  badgeLabel: string;
  badgeColor: string;
  badgeBackground: string;
  directionChip: WatchlistDirectionChip | null;
  /** Shown under momentum when setup failed (border red). */
  statusBanner: string | null;
};

function structureAtActionableBand(
  alignmentTier: AlignmentDisplayTier,
  row: WatchlistMaturationRow | undefined,
  aligned: number
): boolean {
  if (alignmentTier === "actionable") return true;
  const band = row?.progress_band;
  if (band === "actionable") return true;
  return aligned >= ACTIONABLE_ALIGNED_MIN;
}

function sessionBlocksLiveDay(
  planMode: "swing" | "day",
  sessionMode: SessionActivityUiMode | undefined
): boolean {
  if (planMode !== "day") return false;
  return sessionMode === "closed" || sessionMode === "extended";
}

function sessionAllowsSwingGreenWhenClosed(sessionMode: SessionActivityUiMode | undefined): boolean {
  return sessionMode === "closed";
}

export function resolveWatchlistDirectionChip(
  row: WatchlistMaturationRow | undefined,
  colors: WatchlistCardThemeColors
): WatchlistDirectionChip | null {
  const bias = normalizeMaturationBias(row?.bias);
  if (bias === "long") {
    return {
      label: "↑ Long",
      color: colors.bullish,
      background: `color-mix(in srgb, ${colors.bullish} 18%, transparent)`
    };
  }
  if (bias === "short") {
    return {
      label: "↓ Short",
      color: colors.bearish,
      background: `color-mix(in srgb, ${colors.bearish} 18%, transparent)`
    };
  }
  if (isExplicitNeutralMaturationBias(row?.bias)) {
    return {
      label: "No edge",
      color: colors.textMuted,
      background: `color-mix(in srgb, ${colors.textMuted} 14%, transparent)`
    };
  }
  return null;
}

export function resolveWatchlistCardChrome(input: {
  alignmentTier: AlignmentDisplayTier;
  row: WatchlistMaturationRow | undefined;
  blockers: string[];
  desk: WatchlistRadarDeskContext;
  planMode: "swing" | "day";
  colors: WatchlistCardThemeColors;
  attentionTier?: "check_now" | "getting_close" | "tracking";
}): WatchlistCardChrome {
  const { aligned, total } = maturationAlignmentCounts(input.row);
  const sessionMode = input.desk.sessionMode ?? "live";
  const directionChip = resolveWatchlistDirectionChip(input.row, input.colors);

  if (input.alignmentTier === "invalidated") {
    return {
      kind: "invalidated",
      borderLeft: input.colors.bearish,
      borderBottom: input.colors.bearish,
      dotAccent: input.colors.bearish,
      badgeLabel: "Review",
      badgeColor: input.colors.bearish,
      badgeBackground: `color-mix(in srgb, ${input.colors.bearish} 20%, transparent)`,
      directionChip,
      statusBanner: "Setup invalidated — review on Signals"
    };
  }

  const structureStrong = structureAtActionableBand(input.alignmentTier, input.row, aligned);
  const symbolClear = input.blockers.length === 0;
  const deskGated = isWatchlistRadarDeskGated(input.desk);
  const nearReady =
    input.alignmentTier === "near_ready" || input.row?.progress_band === "near_ready";
  const developing = input.alignmentTier === "developing" || input.row?.progress_band === "developing";

  const balancedNoDirection = isBalancedHighAlignment({
    row: input.row,
    alignmentTier: input.alignmentTier,
    aligned,
    total
  });

  const swingPlanGreen =
    !balancedNoDirection &&
    input.planMode === "swing" &&
    sessionAllowsSwingGreenWhenClosed(sessionMode) &&
    structureStrong &&
    symbolClear &&
    !deskGated;

  const liveGreen =
    !balancedNoDirection &&
    sessionMode === "live" &&
    structureStrong &&
    symbolClear &&
    !deskGated;

  if (balancedNoDirection && structureStrong && symbolClear && !deskGated) {
    return {
      kind: "blocked",
      borderLeft: input.colors.textMuted,
      borderBottom: `color-mix(in srgb, ${input.colors.textMuted} 65%, transparent)`,
      dotAccent: input.colors.textMuted,
      badgeLabel: "Balanced",
      badgeColor: input.colors.textMuted,
      badgeBackground: `color-mix(in srgb, ${input.colors.textMuted} 14%, transparent)`,
      directionChip,
      statusBanner: null
    };
  }

  if (liveGreen || swingPlanGreen) {
    const plan = swingPlanGreen && !liveGreen;
    return {
      kind: plan ? "actionable_plan" : "actionable_ready",
      borderLeft: input.colors.bullish,
      borderBottom: input.colors.bullish,
      dotAccent: input.colors.bullish,
      badgeLabel: plan ? "Plan" : "Ready",
      badgeColor: input.colors.bullish,
      badgeBackground: `color-mix(in srgb, ${input.colors.bullish} 20%, transparent)`,
      directionChip,
      statusBanner: null
    };
  }

  const amber =
    input.alignmentTier === "re_evaluating" ||
    nearReady ||
    (developing && input.blockers.length > 0) ||
    input.blockers.length > 0 ||
    deskGated ||
    (structureStrong && sessionBlocksLiveDay(input.planMode, sessionMode)) ||
    (structureStrong && sessionMode === "extended");

  if (amber) {
    const badgeLabel =
      input.attentionTier === "getting_close"
        ? "Building"
        : input.attentionTier === "check_now"
          ? "Check now"
          : "Tracking";
    return {
      kind: "blocked",
      borderLeft: input.colors.caution,
      borderBottom: input.colors.caution,
      dotAccent: input.colors.caution,
      badgeLabel,
      badgeColor: input.colors.caution,
      badgeBackground: `color-mix(in srgb, ${input.colors.caution} 18%, transparent)`,
      directionChip,
      statusBanner: null
    };
  }

  return {
    kind: "tracking",
    borderLeft: input.colors.textMuted,
    borderBottom: `color-mix(in srgb, ${input.colors.textMuted} 65%, transparent)`,
    dotAccent: input.colors.accent,
    badgeLabel: "On your list",
    badgeColor: input.colors.textMuted,
    badgeBackground: `color-mix(in srgb, ${input.colors.textMuted} 14%, transparent)`,
    directionChip,
    statusBanner: null
  };
}
