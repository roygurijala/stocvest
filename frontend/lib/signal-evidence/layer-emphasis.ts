/**
 * Layer-card visual hierarchy + neutral-state compression (B35,
 * 2026-05-13).
 *
 * These helpers own the second-pass UX polish on the Signal Evidence
 * Card's "Signal Layer Breakdown" section, the surface the user
 * described as having three problems:
 *
 *   (3) News=Neutral renders as a no-op chip even though "no catalyst
 *       support" is a *soft headwind* in short-term trading — not the
 *       absence of a signal. The fix is a reframing parenthetical on
 *       the chip text plus a default-collapse on layers that have
 *       nothing actionable to surface beyond their status.
 *
 *   (4) Three full-size cards in a row each saying "Neutral" produces
 *       decision fatigue. When News + Macro + Geopolitical are *all*
 *       neutral on the same setup, the three cards collapse into one
 *       consolidated "Context" row. The original three cards stay
 *       available behind a `<details>` disclosure for users who need
 *       the layer-level detail.
 *
 *   (6) Today every layer renders at identical visual weight. Not all
 *       layers are equally important for an action decision: Technical
 *       is load-bearing; Geopolitical + Sector are context-class and
 *       only matter when they have active content. The fix is an
 *       emphasis-tier helper (`primary` / `secondary` / `tertiary`)
 *       that the card render maps to size + padding + opacity.
 *
 * Design intent (kept here so future edits don't drift):
 *
 *   - Helpers are pure: no React, no fetch, no clock. Easy to test.
 *   - The reframe + compression + emphasis decisions are computed from
 *     the `EvidenceLayer` shape alone, with no additional state needed
 *     on the card.
 *   - Hierarchy is conservative: when in doubt, a layer is rendered
 *     full-size and uncollapsed. The collapse / compress paths only
 *     activate when there is *demonstrably* nothing useful to surface.
 *   - We never collapse Technical. The Technical layer is the
 *     load-bearing layer for action; rendering it as anything other
 *     than primary would be a UX regression.
 *
 * Lock-in tests live in
 * `frontend/tests/layer-emphasis.test.ts`.
 */

import type { EvidenceLayer, EvidenceStatus } from "@/lib/signal-evidence";

/**
 * Visual-weight tier the card render uses to scale padding, font size,
 * and elevation for a layer article.
 *
 *   - `primary`   — full-size, eye-catching. Reserved for the layers
 *                   that decide actionability (currently Technical).
 *   - `secondary` — default size, matches today's render. Used for
 *                   News, Macro, Internals — context-class layers that
 *                   still meaningfully shift the read.
 *   - `tertiary`  — compact, muted opacity. Used for Sector and
 *                   Geopolitical when they have no active content;
 *                   promotes to `secondary` the moment either lights up.
 */
export type LayerEmphasisTier = "primary" | "secondary" | "tertiary";

/**
 * Set of layer keys that are ALWAYS rendered as `primary`. Technical
 * is the only one today — it is the load-bearing layer for any action
 * decision and de-emphasising it would be a UX regression.
 *
 * Exported as a frozen tuple so tests can assert on its membership
 * without re-typing the list.
 */
export const PRIMARY_LAYER_KEYS = ["technical"] as const;

/**
 * Set of layer keys that default to `tertiary` but get promoted to
 * `secondary` when `layerHasActiveContent` returns true for that
 * specific layer.
 *
 * Geopolitical is a context-class layer that only matters when there
 * is an active event surfaced or a non-baseline exposure score on
 * the symbol's sector.
 *
 * Sector is a context-class layer that only matters when the resolver
 * has confirmed a sector AND there is non-trivial momentum data — the
 * common "unresolved sector" or "neutral interpretation" cases are
 * pure noise on intraday/swing decisions.
 */
export const TERTIARY_DEFAULT_LAYER_KEYS = ["geopolitical", "sector"] as const;

/**
 * Set of layer keys that participate in the "compressed Context"
 * grouping. When all three of these are simultaneously `Neutral`, the
 * card render collapses them into a single consolidated row.
 *
 * Exported so the render path and the tests share one source of truth
 * for which layers cluster into Context.
 */
export const CONTEXT_LAYER_KEYS = ["news", "macro", "geopolitical"] as const;

/**
 * Returns `true` if the layer has *demonstrably actionable content*
 * beyond its bare status chip + the standard explanation paragraph.
 * The card render uses this to:
 *
 *   - Promote a `tertiary`-default layer (sector / geopolitical) up to
 *     `secondary` when there's something to look at.
 *   - Decide whether a `Neutral` layer is genuinely empty (default-
 *     collapsed) vs neutral-with-detail (default-expanded so the user
 *     sees the detail even if the headline reads Neutral).
 *
 * "Active content" is layer-specific:
 *
 *   - macro:        critical / elevated risk_level with warnings, OR
 *                   any upcoming_events at status `imminent` / `today`,
 *                   OR an inverted yield curve.
 *   - news:         any rating action that isn't a routine hold, OR
 *                   a guidance change (raised / lowered), OR an
 *                   earnings beat-or-miss with a non-null `beat` flag,
 *                   OR a WIM summary blob from Benzinga.
 *   - sector:       a resolved sector with `data_available` true AND
 *                   either a non-zero leading-session count or any
 *                   daily session data.
 *   - geopolitical: any active geo event OR a `geoHasLiveEvents` flag
 *                   set, regardless of the baseline score.
 *   - technical:    always considered active — it is the load-bearing
 *                   layer and never collapses by this helper.
 *   - internals:    treated as active when any `keyPoints` are present
 *                   (the internals layer doesn't carry rich extras the
 *                   way the others do).
 *   - default:      any other layer is considered active when it has
 *                   non-trivial `keyPoints` (≥ 2 chips) OR the layer's
 *                   explanation runs longer than the bare default.
 *
 * Defensive: a layer with status `"Unavailable"` is considered NOT
 * active (it had nothing to evaluate, so any rich extras are stale).
 *
 * @param layer - The hydrated `EvidenceLayer` from the API.
 * @returns true when the layer has content worth surfacing.
 */
export function layerHasActiveContent(layer: EvidenceLayer): boolean {
  if (layer.status === "Unavailable") return false;
  // Technical is always considered active — never collapse it.
  if (layer.key === "technical") return true;

  switch (layer.key) {
    case "macro": {
      // Activity check mirrors what the macro card actually renders:
      //   - critical / elevated risk_level with warnings → red/amber
      //     banner is shown.
      //   - any `upcoming_events` (any status) → the "Upcoming" list
      //     renders, slicing the first three.
      //   - any `yield_curve` (any regime) → the yield-curve line
      //     renders with color keyed on regime.
      // If the macro layer has none of those things, the rendered body
      // collapses to just the explanation line, which is what the
      // user means by "nothing to show" — compress it.
      if (layer.macro_risk_level === "critical" || layer.macro_risk_level === "elevated") {
        if ((layer.macro_warnings?.length ?? 0) > 0) return true;
      }
      if ((layer.upcoming_events ?? []).length > 0) return true;
      if (layer.yield_curve != null) return true;
      return false;
    }
    case "news": {
      // Any rich news extras that the card renders inline.
      if (typeof layer.wim_summary === "string" && layer.wim_summary.trim().length > 0) return true;
      if (layer.latest_rating) {
        const action = String(layer.latest_rating.action ?? "").toLowerCase();
        if (action === "upgrade" || action === "downgrade" || action === "initiates") return true;
      }
      if (layer.analyst_consensus?.label) return true;
      if (layer.latest_guidance) {
        const t = String(layer.latest_guidance.type ?? "").toLowerCase();
        if (t === "raised" || t === "lowered") return true;
      }
      if (layer.earnings_result && layer.earnings_result.beat !== null) return true;
      // The card also renders an empty-state copy line when news data
      // is stale with zero articles ("No qualifying news for ..."). The
      // copy IS something to show — the user wants the news layer
      // visible standalone (with the soft-negative parenthetical
      // alongside) rather than folded into the compressed Context card
      // where the empty-state line wouldn't render.
      if (
        layer.news_data_state === "stale" &&
        (layer.articles_count === 0 || layer.articles_count === undefined)
      ) {
        return true;
      }
      return false;
    }
    case "sector": {
      if (layer.sector_resolution_state === "pending_cache_refresh") return false;
      const hasBenchmark =
        Boolean(layer.sector_etf?.trim()) || Boolean(layer.sector_display_name?.trim());
      if (hasBenchmark) return true;
      if (layer.sector_resolution_state !== "resolved") return false;
      if (layer.sector_data_available !== true) return false;
      const lead = layer.sector_sessions_leading ?? 0;
      const total = layer.sector_total_sessions ?? 0;
      const persistence = layer.sector_persistence ?? 0;
      if (lead > 0 || persistence > 0) return true;
      if ((layer.sector_daily_sessions?.length ?? 0) > 0) return true;
      // Resolved + data_available but zero lead + zero persistence means
      // the symbol is in a known sector that is tracking the index
      // neutrally — useful background but not "active" for decisions.
      return total > 0 && lead > 0;
    }
    case "geopolitical": {
      // The geo card renders one of two panels depending on `layer.geo`:
      //
      //   - `GeopoliticalExposurePanel` when there are active events
      //     or `geoHasLiveEvents` is true.
      //   - `GeoStructuralBaselinePanel` otherwise — which only
      //     carries meaningful copy when at least one of
      //     `geoBaselineSummary`, `exposureSummary`,
      //     `geoBaselineScore`, or `geoPrimaryTheme` is populated.
      //
      // A `layer.geo` with only `impactSectorLabel` + `exposureBand`
      // and no narrative is the "we know the sector but have nothing
      // structural to say" case — those layers stay tertiary so the
      // card isn't promoted just because the sector mapper resolved.
      if (!layer.geo) return false;
      if ((layer.geo.activeEvents?.length ?? 0) > 0) return true;
      if (layer.geo.geoHasLiveEvents === true) return true;
      if (
        typeof layer.geo.geoBaselineSummary === "string" &&
        layer.geo.geoBaselineSummary.trim().length > 0
      ) {
        return true;
      }
      if (
        typeof layer.geo.exposureSummary === "string" &&
        layer.geo.exposureSummary.trim().length > 0
      ) {
        return true;
      }
      if (typeof layer.geo.geoBaselineScore === "number") return true;
      if (
        typeof layer.geo.geoPrimaryTheme === "string" &&
        layer.geo.geoPrimaryTheme.length > 0
      ) {
        return true;
      }
      return false;
    }
    case "internals":
    default: {
      const chips = (layer.keyPoints ?? []).filter((p) => p && p.trim().length > 0);
      return chips.length >= 2;
    }
  }
}

/**
 * Decide which visual-weight tier the card render should apply to a
 * given layer.
 *
 * Algorithm:
 *
 *   1. Technical is always `primary` — it is the load-bearing layer.
 *   2. Sector + Geopolitical default to `tertiary`. They promote to
 *      `secondary` when `layerHasActiveContent` is true OR the layer
 *      status is anything other than Neutral / Unavailable (a Bullish
 *      sector chip is content, even with no momentum rows).
 *   3. Every other layer is `secondary` by default and demotes to
 *      `tertiary` only if it is Unavailable.
 *
 * This keeps the hierarchy conservative: layers default to *more*
 * emphasis, not less, so we never accidentally hide signal.
 */
export function layerEmphasisTier(layer: EvidenceLayer): LayerEmphasisTier {
  if ((PRIMARY_LAYER_KEYS as readonly string[]).includes(layer.key)) {
    return "primary";
  }
  if ((TERTIARY_DEFAULT_LAYER_KEYS as readonly string[]).includes(layer.key)) {
    const directional = layer.status === "Bullish" || layer.status === "Bearish";
    if (directional || layerHasActiveContent(layer)) return "secondary";
    return "tertiary";
  }
  // Everything else (news, macro, internals, any future addition):
  // secondary unless wholly unavailable.
  if (layer.status === "Unavailable") return "tertiary";
  return "secondary";
}

/**
 * Returns `true` if a layer should be rendered with its body collapsed
 * by default. The card render shows the header (icon + name + status)
 * always; the explanation + chips + extras hide behind a `<details>`
 * disclosure.
 *
 * Collapse conditions:
 *
 *   - Layer is Neutral OR Unavailable (no directional signal).
 *   - Layer has no active content per `layerHasActiveContent`.
 *   - Layer is NOT Technical (Technical never collapses).
 *
 * Bullish / Bearish layers always render expanded — a directional
 * signal is by definition not "nothing to show."
 */
export function isLayerCompressible(layer: EvidenceLayer): boolean {
  if (layer.key === "technical") return false;
  if (layer.status === "Bullish" || layer.status === "Bearish") return false;
  return !layerHasActiveContent(layer);
}

/**
 * Returns `true` if the news layer has a directionally *positive*
 * catalyst the user can lean on — an upgrade rating, a raised
 * guidance, an earnings beat, or a non-empty Benzinga "WIM" summary.
 *
 * The "stale + 0 articles" empty-state DOES render copy in the card,
 * but it isn't a positive catalyst — it's the absence of one. So this
 * helper deliberately returns `false` in that case, which is exactly
 * the situation where the soft-negative parenthetical needs to fire.
 *
 * This is intentionally decoupled from `layerHasActiveContent` because
 * the two ask different questions:
 *
 *   - `layerHasActiveContent` answers: "Is there anything to render?"
 *     (used for compression / default-collapse decisions).
 *   - `hasNewsPositiveCatalyst` answers: "Is there evidence that
 *     supports continuation?" (used for the parenthetical decision).
 */
function hasNewsPositiveCatalyst(layer: EvidenceLayer): boolean {
  if (layer.key !== "news") return false;
  if (typeof layer.wim_summary === "string" && layer.wim_summary.trim().length > 0) return true;
  if (layer.latest_rating) {
    const action = String(layer.latest_rating.action ?? "").toLowerCase();
    if (
      action === "upgrade" ||
      action === "downgrade" ||
      action === "initiates" ||
      action === "maintains" ||
      action.includes("reiterat")
    ) {
      return true;
    }
  }
  if (layer.analyst_consensus && (layer.analyst_consensus.momentum ?? 0) >= 3) return true;
  if (layer.latest_guidance) {
    const t = String(layer.latest_guidance.type ?? "").toLowerCase();
    if (t === "raised" || t === "lowered") return true;
  }
  if (layer.earnings_result && layer.earnings_result.beat !== null) return true;
  return false;
}

/**
 * Returns the soft-negative parenthetical that should be appended to a
 * `News: Neutral` chip / explanation, or `null` if the parenthetical
 * should not apply.
 *
 * The user's framing (BRK.B feedback, 2026-05-13):
 *
 *   > "No news is not truly neutral in short-term trading. Reframe to
 *   >  'News: Neutral (no catalyst support → lowers continuation
 *   >  probability)'."
 *
 * The parenthetical applies to the **News** layer when:
 *
 *   - status is `Neutral` AND
 *   - no positive catalyst is surfaced (no upgrade rating, no raised
 *     guidance, no earnings beat, no WIM summary).
 *
 * Crucially it can fire even when the news card renders the "stale +
 * 0 articles" empty-state copy — the empty-state copy is the data
 * face of "no catalyst," and the parenthetical is the implication.
 * Both belong on the card.
 *
 * Returns `null` for every other layer and for News with a positive
 * catalyst (where rendering "no catalyst" would be a lie).
 */
export function buildNewsNeutralParenthetical(layer: EvidenceLayer): string | null {
  if (layer.key !== "news") return null;
  if (layer.status !== "Neutral") return null;
  if (hasNewsPositiveCatalyst(layer)) return null;
  return "no catalyst support → lowers continuation probability";
}

/**
 * Returns `true` if the three context-class layers (News, Macro,
 * Geopolitical) are ALL simultaneously Neutral with no active content.
 * When true, the card render replaces the three full-size cards with a
 * single consolidated "Context" row to fight decision fatigue.
 *
 * The check is strict on purpose:
 *
 *   - All three must be present in `layers` (we never compress a card
 *     that wasn't going to render anyway).
 *   - All three must be Neutral (any directional flip breaks the
 *     grouping — the user needs to see the bullish/bearish chip).
 *   - None can have active content (an upcoming macro event or active
 *     geo event is exactly the case where the user needs the layer
 *     visible).
 */
export function shouldCompressContextLayers(layers: ReadonlyArray<EvidenceLayer>): boolean {
  const byKey = new Map(layers.map((l) => [l.key, l] as const));
  for (const k of CONTEXT_LAYER_KEYS) {
    const layer = byKey.get(k);
    if (!layer) return false;
    if (layer.status !== "Neutral") return false;
    if (layerHasActiveContent(layer)) return false;
  }
  return true;
}

/**
 * Wire shape of the consolidated Context card the render uses when
 * `shouldCompressContextLayers` is true. Pure data — the renderer
 * decides the visual treatment.
 */
export interface CompressedContextSummary {
  /** Display title for the compressed card. */
  title: string;
  /** Single-line headline that replaces the three full layer cards. */
  headline: string;
  /** Status pill text (always "Neutral" in this build). */
  statusLabel: EvidenceStatus;
  /** Layer keys folded into this group (kept stable for tests). */
  collapsedLayerKeys: ReadonlyArray<string>;
  /** Original layer rows kept for the `<details>` disclosure. */
  layers: ReadonlyArray<EvidenceLayer>;
}

/**
 * Build the consolidated "Context" payload the renderer expands into a
 * single card. The function assumes the caller has already gated on
 * `shouldCompressContextLayers(layers) === true` — if any context
 * layer is missing, the function returns `null` instead of throwing,
 * so an unexpected call site degrades to the un-compressed render.
 *
 * Copy is deliberately data-only ("no macro or news tailwinds
 * present") — never advice-flavored. The user-facing intent is to
 * surface the *absence* of supportive context as a single fact, not as
 * a recommendation.
 */
export function buildCompressedContextSummary(
  layers: ReadonlyArray<EvidenceLayer>
): CompressedContextSummary | null {
  const byKey = new Map(layers.map((l) => [l.key, l] as const));
  const collapsed: EvidenceLayer[] = [];
  for (const k of CONTEXT_LAYER_KEYS) {
    const layer = byKey.get(k);
    if (!layer) return null;
    collapsed.push(layer);
  }
  return {
    title: "Context",
    headline: "Neutral (no macro or news tailwinds present)",
    statusLabel: "Neutral",
    collapsedLayerKeys: [...CONTEXT_LAYER_KEYS],
    layers: collapsed
  };
}
