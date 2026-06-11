/**
 * Shared bullish / bearish / neutral color semantics across trading room,
 * layers breakdown, and feed cards.
 *
 * Bullish → green, Bearish → red, Neutral / mixed-unknown → grey (textMuted).
 */

import type { FeedBias } from "@/lib/dashboard/trading-room/feed-model";
import type { SignalsLayerStatus } from "@/lib/signals-page-present";

export type DirectionPalette = {
  bullish: string;
  bearish: string;
  textMuted: string;
};

export function layerStatusColor(
  status: SignalsLayerStatus | string | undefined,
  colors: DirectionPalette
): string {
  const s = String(status ?? "").toLowerCase();
  if (s === "bullish") return colors.bullish;
  if (s === "bearish") return colors.bearish;
  return colors.textMuted;
}

export function feedBiasColor(bias: FeedBias, colors: DirectionPalette): string {
  if (bias === "bull") return colors.bullish;
  if (bias === "bear") return colors.bearish;
  return colors.textMuted;
}

export function polarityTrendIconKind(
  polarity: string
): "up" | "down" | "flat" {
  const p = polarity.toLowerCase();
  if (p === "supportive" || p === "with") return "up";
  if (p === "blocking" || p === "against") return "down";
  return "flat";
}
