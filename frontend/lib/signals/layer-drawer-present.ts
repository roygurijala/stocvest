/**
 * Curates layer drawer content — avoids repeating the same facts across
 * analysis, chips, justification rows, and rich evidence blocks.
 */

import type { LayerCatalystArticle } from "@/lib/signals/layer-catalyst-articles";
import type { SignalsLayerRowInput, SignalsSetupBias } from "@/lib/signals-page-present";

export const LAYER_DRAWER_ARTICLE_PREVIEW = 3;
export const LAYER_DRAWER_ARTICLE_MAX = 6;
export const LAYER_DRAWER_RATING_PREVIEW = 2;
export const LAYER_DRAWER_EVENT_PREVIEW = 2;
export const LAYER_DRAWER_SECTOR_SESSION_PREVIEW = 2;
export const LAYER_DRAWER_CHIP_MAX = 4;
export const LAYER_DRAWER_INDICATOR_MAX = 6;

function isRedundantChip(chip: string, layer: SignalsLayerRowInput): boolean {
  const c = chip.trim();
  if (!c) return true;
  if (/^\d+\s+articles?$/i.test(c)) return Boolean(layer.catalystArticles?.length);
  if (/sent_avg|headline\s+[+-]/i.test(c)) return Boolean(layer.catalystArticles?.length);
  if (/^Catalyst:/i.test(c)) return Boolean(layer.catalystArticles?.length);
  if (/^Analyst 30d:/i.test(c)) return Boolean(layer.recentRatings && layer.recentRatings.length > 1);
  if (/^RSI\s/i.test(c)) return layer.indicatorSnapshot?.rsi != null || layer.indicatorSnapshot?.daily_rsi != null;
  if (/^Vol\s/i.test(c)) return layer.indicatorSnapshot?.volume_vs_adv != null;
  if (/^EMA Stack/i.test(c)) return layer.indicatorSnapshot?.ema_alignment != null;
  if (/^Breadth\s/i.test(c)) return Boolean(layer.breadthSignal);
  if (/^Participation\s/i.test(c)) return Boolean(layer.participationSignal);
  if (/^VIX:/i.test(c)) return layer.key === "internals";
  return false;
}

/** Chips that add context not already shown in structured evidence blocks. */
export function filterDisplayChips(layer: SignalsLayerRowInput): string[] {
  if (!layer.chips?.length) return [];
  const out: string[] = [];
  for (const chip of layer.chips) {
    if (isRedundantChip(chip, layer)) continue;
    if (out.includes(chip)) continue;
    out.push(chip);
    if (out.length >= LAYER_DRAWER_CHIP_MAX) break;
  }
  return out;
}

export function articlesForDrawer(
  articles: LayerCatalystArticle[] | undefined,
  expanded: boolean
): { visible: LayerCatalystArticle[]; hiddenCount: number } {
  if (!articles?.length) return { visible: [], hiddenCount: 0 };
  const limit = expanded ? LAYER_DRAWER_ARTICLE_MAX : LAYER_DRAWER_ARTICLE_PREVIEW;
  const visible = articles.slice(0, limit);
  return { visible, hiddenCount: Math.max(0, articles.length - visible.length) };
}

export function ratingsForDrawer(
  ratings: SignalsLayerRowInput["recentRatings"],
  expanded: boolean
): { visible: NonNullable<SignalsLayerRowInput["recentRatings"]>; hiddenCount: number } {
  if (!ratings?.length) return { visible: [], hiddenCount: 0 };
  const limit = expanded ? ratings.length : LAYER_DRAWER_RATING_PREVIEW;
  const visible = ratings.slice(0, limit);
  return { visible, hiddenCount: Math.max(0, ratings.length - visible.length) };
}

const INDICATOR_HIGHLIGHT_KEYS = [
  "daily_rsi",
  "rsi",
  "sma20",
  "sma50",
  "sma200",
  "ema9",
  "ema20",
  "vwap_from_bars",
  "vwap_state",
  "ema_alignment",
  "volume_vs_adv",
  "volume_regime",
  "macd_above_signal",
  "golden_cross",
  "orb_signal"
] as const;

const SKIP_INDICATOR_KEYS = new Set(["mode", "bars_analyzed", "base_days", "base_range_pct", "orb_qualified", "in_base"]);

export function indicatorHighlights(
  snapshot: SignalsLayerRowInput["indicatorSnapshot"]
): Array<[string, string | number | boolean | null]> {
  if (!snapshot) return [];
  const out: Array<[string, string | number | boolean | null]> = [];
  for (const key of INDICATOR_HIGHLIGHT_KEYS) {
    if (!(key in snapshot)) continue;
    const value = snapshot[key];
    if (value === false || value === null || value === undefined) continue;
    out.push([key, value]);
    if (out.length >= LAYER_DRAWER_INDICATOR_MAX) break;
  }
  if (out.length < LAYER_DRAWER_INDICATOR_MAX) {
    for (const [key, value] of Object.entries(snapshot)) {
      if (SKIP_INDICATOR_KEYS.has(key)) continue;
      if (INDICATOR_HIGHLIGHT_KEYS.includes(key as (typeof INDICATOR_HIGHLIGHT_KEYS)[number])) continue;
      if (value === false || value === null || value === undefined) continue;
      out.push([key, value]);
      if (out.length >= LAYER_DRAWER_INDICATOR_MAX) break;
    }
  }
  return out;
}

export function buildLayerAlignmentLine(
  layer: SignalsLayerRowInput,
  bias: SignalsSetupBias,
  polarity: "supportive" | "blocking" | "mixed" | "neutral",
  scoreLabel: string
): string {
  const statusLower = String(layer.status ?? "").toLowerCase();
  const scoreNum = layer.score;
  const singleArticle =
    layer.articleCount === 1 || (layer.catalystArticles?.length === 1 && layer.articleCount == null);
  const weakRead = scoreNum != null && singleArticle && (scoreNum <= 8 || scoreNum >= 92);

  if (bias === "Neutral") {
    if (statusLower === "bullish") return `Bullish read (${scoreLabel}) inside a neutral setup.`;
    if (statusLower === "bearish") return `Bearish read (${scoreLabel}) inside a neutral setup.`;
    return `Neutral read (${scoreLabel}) — no directional edge from this layer.`;
  }
  if (weakRead && polarity === "supportive") {
    return `Directionally aligned, but only one thin headline — treat as low-conviction context.`;
  }
  if (polarity === "supportive") return `Supporting your ${bias.toLowerCase()} setup.`;
  if (polarity === "blocking") return `Working against your ${bias.toLowerCase()} setup.`;
  if (polarity === "mixed") return `Mixed signals relative to your ${bias.toLowerCase()} setup.`;
  return `Neutral to your ${bias.toLowerCase()} setup.`;
}

/** Data coverage confidence — not the same as directional layer score. */
export function layerDataConfidenceTier(layer: SignalsLayerRowInput): "High" | "Medium" | "Low" {
  if (layer.status === "Unavailable") return "Low";
  if (layer.key === "news") {
    const count = layer.articleCount ?? layer.catalystArticles?.length ?? 0;
    if (count >= 3) return "High";
    if (count >= 1) return "Medium";
    return "Low";
  }
  const s = layer.score;
  if (s == null) return "Low";
  const dist = Math.abs(s - 50);
  if (dist >= 25) return "High";
  if (dist >= 12) return "Medium";
  return "Low";
}

export function layerAlignmentTextColor(
  polarity: "supportive" | "blocking" | "mixed" | "neutral",
  bias: SignalsSetupBias,
  colors: { bullish: string; bearish: string; textMuted: string }
): string {
  if (polarity === "supportive") {
    return bias === "Bearish" ? colors.bearish : colors.bullish;
  }
  if (polarity === "blocking") {
    return bias === "Bearish" ? colors.bullish : colors.bearish;
  }
  return colors.textMuted;
}

/** Analyst timeline only when it adds more than a single latest-rating summary. */
export function shouldShowAnalystTimeline(layer: SignalsLayerRowInput): boolean {
  return Boolean(layer.recentRatings && layer.recentRatings.length > 0);
}

export function shouldShowMacroEventList(layer: SignalsLayerRowInput): boolean {
  return Boolean(layer.upcomingEvents && layer.upcomingEvents.length > 0);
}

export function shouldShowGeoEventList(layer: SignalsLayerRowInput): boolean {
  return Boolean(layer.geoActiveEvents && layer.geoActiveEvents.length > 0);
}
