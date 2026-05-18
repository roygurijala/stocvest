/**
 * B47 — Progress presentation: display-only alignment tiers.
 *
 * Backend maturation (`derive_state`) stays unchanged (Actionable ≥5/6, Developing ≥3/6).
 * UI adds "Near ready" at 4/6 so users see progression without relaxing gates.
 */

import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

export const LAYER_TOTAL_DEFAULT = 6;

/** Mirrors `stocvest/models/watchlist.py` — keep in sync for labels only. */
export const ACTIONABLE_ALIGNED_MIN = 5;
export const DEVELOPING_ALIGNED_MIN = 2;
export const NEAR_READY_ALIGNED = 4;

export type AlignmentDisplayTier =
  | "not_aligned"
  | "developing"
  | "near_ready"
  | "actionable"
  | "invalidated"
  | "re_evaluating";

export type AlignmentDisplayTone = "bearish" | "caution" | "near" | "bullish" | "muted" | "info";

export type AlignmentDisplayMeta = {
  tier: AlignmentDisplayTier;
  label: string;
  shortLabel: string;
  emoji: string;
  tone: AlignmentDisplayTone;
  layersAligned: number;
  layersTotal: number;
};

function clampAligned(aligned: number, total: number): number {
  if (!Number.isFinite(aligned)) return 0;
  return Math.max(0, Math.min(total, Math.round(aligned)));
}

export function normalizeMaturationStateKey(state: string | null | undefined): string {
  return (state ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * Resolve user-facing tier from layer counts. Optional maturation state handles
 * invalidated / re-evaluating without changing backend thresholds.
 */
export function resolveAlignmentDisplayTier(input: {
  layersAligned: number;
  layersTotal?: number;
  maturationState?: string | null;
}): AlignmentDisplayTier {
  const total =
    typeof input.layersTotal === "number" && input.layersTotal > 0
      ? input.layersTotal
      : LAYER_TOTAL_DEFAULT;
  const aligned = clampAligned(input.layersAligned, total);
  const mat = normalizeMaturationStateKey(input.maturationState);

  if (mat === "invalidated") return "invalidated";
  if (mat === "re_evaluating") return "re_evaluating";
  if (mat === "actionable" || aligned >= ACTIONABLE_ALIGNED_MIN) return "actionable";
  if (aligned === NEAR_READY_ALIGNED) return "near_ready";
  if (aligned >= DEVELOPING_ALIGNED_MIN || mat === "developing") return "developing";
  return "not_aligned";
}

const TIER_LABEL: Record<AlignmentDisplayTier, string> = {
  not_aligned: "Not aligned",
  developing: "Developing",
  near_ready: "Near ready",
  actionable: "Actionable",
  invalidated: "Invalidated",
  re_evaluating: "Re-evaluating"
};

const TIER_EMOJI: Record<AlignmentDisplayTier, string> = {
  not_aligned: "🔴",
  developing: "🟠",
  near_ready: "🟡",
  actionable: "🟢",
  invalidated: "⚫",
  re_evaluating: "🔵"
};

const TIER_TONE: Record<AlignmentDisplayTier, AlignmentDisplayTone> = {
  not_aligned: "bearish",
  developing: "caution",
  near_ready: "near",
  actionable: "bullish",
  invalidated: "bearish",
  re_evaluating: "info"
};

export function alignmentDisplayMeta(input: {
  layersAligned: number;
  layersTotal?: number;
  maturationState?: string | null;
}): AlignmentDisplayMeta {
  const total =
    typeof input.layersTotal === "number" && input.layersTotal > 0
      ? input.layersTotal
      : LAYER_TOTAL_DEFAULT;
  const aligned = clampAligned(input.layersAligned, total);
  const tier = resolveAlignmentDisplayTier(input);
  const label = TIER_LABEL[tier];
  return {
    tier,
    label,
    shortLabel: label,
    emoji: TIER_EMOJI[tier],
    tone: TIER_TONE[tier],
    layersAligned: aligned,
    layersTotal: total
  };
}

/** e.g. "Near ready (4/6)" */
export function formatAlignmentStatusLine(input: {
  layersAligned: number;
  layersTotal?: number;
  maturationState?: string | null;
}): string {
  const meta = alignmentDisplayMeta(input);
  if (meta.tier === "not_aligned" && meta.layersAligned <= 1) {
    return meta.label;
  }
  if (meta.tier === "invalidated") {
    return meta.label;
  }
  return `${meta.label} (${meta.layersAligned}/${meta.layersTotal})`;
}

/** Layers still needed to reach actionable threshold (5/6). */
export function layersAwayFromActionable(layersAligned: number, layersTotal = LAYER_TOTAL_DEFAULT): number {
  const aligned = clampAligned(layersAligned, layersTotal);
  const gap = ACTIONABLE_ALIGNED_MIN - aligned;
  return gap > 0 ? gap : 0;
}

/** User-facing distance copy — null when already at actionable band. */
export function formatLayersFromActionableHint(
  layersAligned: number,
  layersTotal = LAYER_TOTAL_DEFAULT
): string | null {
  const away = layersAwayFromActionable(layersAligned, layersTotal);
  if (away <= 0) return null;
  if (away === 1) return "one layer from actionable threshold";
  return `${away} layers from actionable threshold`;
}

/** Maturation row → display line (Near ready at 4/6, etc.). */
export function formatWatchlistMaturationDisplayLine(row: WatchlistMaturationRow | undefined): string | null {
  if (!row) return null;
  const st = normalizeMaturationStateKey(row.state ?? row.label);
  const aligned = row.layers_aligned;
  const total = row.layers_total ?? LAYER_TOTAL_DEFAULT;
  if (typeof aligned === "number" && Number.isFinite(aligned) && st) {
    return formatAlignmentStatusLine({
      layersAligned: aligned,
      layersTotal: total,
      maturationState: row.state ?? st
    });
  }
  const raw = (row.label || row.state || "").trim();
  if (!raw) return null;
  return raw.replace(/_/g, " ");
}

/** Observational chip when the last evaluation moved layer alignment (B47). */
export function formatWatchlistProgressionChip(row: WatchlistMaturationRow | undefined): string | null {
  if (!row) return null;
  const prev = row.previous_layers_aligned;
  const type = row.last_transition_type;
  const total = row.layers_total ?? LAYER_TOTAL_DEFAULT;
  if (typeof prev !== "number" || !Number.isFinite(prev)) return null;
  if (type === "improved") return `↑ from ${prev}/${total}`;
  if (type === "worsened") return `↓ from ${prev}/${total}`;
  return null;
}
