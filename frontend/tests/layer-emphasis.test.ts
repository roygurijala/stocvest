/**
 * Lock-in tests for the layer-emphasis + context-compression helpers
 * (B35, BRK.B follow-up feedback, 2026-05-13).
 *
 * These pin the user-facing contract on:
 *
 *   - Which layers default to which emphasis tier
 *   - When Sector + Geopolitical promote from `tertiary` to `secondary`
 *   - When a layer is "compressible" (default-collapsed) vs expanded
 *   - The exact News=Neutral parenthetical text
 *   - When the three context layers compress into a single row
 *   - The BRK.B regression — the screenshot's News + Macro + Geopolitical
 *     were all Neutral with nothing actionable, and they MUST compress.
 *
 * Helpers are pure so the tests are pure too — no React, no fetch.
 */

import { describe, expect, test } from "vitest";

import {
  CONTEXT_LAYER_KEYS,
  PRIMARY_LAYER_KEYS,
  TERTIARY_DEFAULT_LAYER_KEYS,
  buildCompressedContextSummary,
  buildNewsNeutralParenthetical,
  isLayerCompressible,
  layerEmphasisTier,
  layerHasActiveContent,
  shouldCompressContextLayers
} from "@/lib/signal-evidence/layer-emphasis";
import type { EvidenceLayer, EvidenceStatus } from "@/lib/signal-evidence";

function makeLayer(overrides: Partial<EvidenceLayer> & { key: string }): EvidenceLayer {
  const status: EvidenceStatus = overrides.status ?? "Neutral";
  return {
    key: overrides.key,
    icon: overrides.icon ?? "•",
    name: overrides.name ?? overrides.key,
    status,
    weightPercent: overrides.weightPercent ?? 10,
    explanation: overrides.explanation ?? "Layer explanation.",
    keyPoints: overrides.keyPoints ?? [],
    contributionScore: overrides.contributionScore ?? 0,
    freshnessLabel: overrides.freshnessLabel ?? "fresh",
    ...overrides
  };
}

// ─────────────────────────────────────────────────────────────────────
// Section: constants are stable
// ─────────────────────────────────────────────────────────────────────

describe("layer-emphasis constants — stable membership", () => {
  test("test_PRIMARY_LAYER_KEYS_is_exactly_technical", () => {
    // Technical is the load-bearing layer. If this set ever grows, the
    // grower MUST justify the addition — uncritically promoting more
    // layers to primary creates a visual-noise regression.
    expect([...PRIMARY_LAYER_KEYS]).toEqual(["technical"]);
  });

  test("test_TERTIARY_DEFAULT_LAYER_KEYS_includes_geopolitical_and_sector", () => {
    // Encodes the user's "reduce emphasis: Geo + Sector unless active"
    // feedback. Adding/removing from this list shifts the visual
    // hierarchy in a way that needs an explicit decision.
    const set = new Set(TERTIARY_DEFAULT_LAYER_KEYS);
    expect(set.has("geopolitical")).toBe(true);
    expect(set.has("sector")).toBe(true);
    expect(set.size).toBe(2);
  });

  test("test_CONTEXT_LAYER_KEYS_is_news_macro_geopolitical", () => {
    // News + Macro + Geopolitical compress when all are neutral. The
    // user's framing is that *those three* are the "is there a
    // tailwind?" cluster. Internals + Sector + Technical are NOT in
    // this cluster (Internals is breadth, Sector is rotation,
    // Technical is the load-bearing layer).
    expect([...CONTEXT_LAYER_KEYS]).toEqual(["news", "macro", "geopolitical"]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Section: layerEmphasisTier — tier assignment
// ─────────────────────────────────────────────────────────────────────

describe("layerEmphasisTier — Technical is always primary", () => {
  test("test_technical_neutral_is_primary", () => {
    expect(layerEmphasisTier(makeLayer({ key: "technical", status: "Neutral" }))).toBe("primary");
  });
  test("test_technical_bullish_is_primary", () => {
    expect(layerEmphasisTier(makeLayer({ key: "technical", status: "Bullish" }))).toBe("primary");
  });
  test("test_technical_unavailable_is_still_primary", () => {
    // Edge case: even when technical reads Unavailable, we keep it
    // primary so the user immediately sees "Technical layer is offline"
    // rather than de-emphasising the most important layer.
    expect(layerEmphasisTier(makeLayer({ key: "technical", status: "Unavailable" }))).toBe("primary");
  });
});

describe("layerEmphasisTier — Sector defaults to tertiary, promotes when active", () => {
  test("test_sector_neutral_no_data_is_tertiary", () => {
    expect(
      layerEmphasisTier(
        makeLayer({
          key: "sector",
          status: "Neutral",
          sector_resolution_state: "unmapped"
        })
      )
    ).toBe("tertiary");
  });

  test("test_sector_bullish_status_promotes_to_secondary", () => {
    // A directional sector chip is information even without momentum
    // rows. Promote to secondary so the user sees the chip prominently.
    expect(
      layerEmphasisTier(
        makeLayer({
          key: "sector",
          status: "Bullish",
          sector_resolution_state: "resolved"
        })
      )
    ).toBe("secondary");
  });

  test("test_sector_neutral_with_active_momentum_promotes_to_secondary", () => {
    expect(
      layerEmphasisTier(
        makeLayer({
          key: "sector",
          status: "Neutral",
          sector_resolution_state: "resolved",
          sector_data_available: true,
          sector_sessions_leading: 3,
          sector_total_sessions: 5,
          sector_persistence: 0.6
        })
      )
    ).toBe("secondary");
  });
});

describe("layerEmphasisTier — Geopolitical defaults to tertiary, promotes when active", () => {
  test("test_geo_neutral_no_events_is_tertiary", () => {
    expect(
      layerEmphasisTier(
        makeLayer({
          key: "geopolitical",
          status: "Neutral",
          geo: {
            impactSectorKey: "tech",
            impactSectorLabel: "Technology",
            stockExposureScore: 0,
            exposureBand: "low",
            exposureSummary: null,
            activeEvents: [],
            eventDetails: []
          }
        })
      )
    ).toBe("tertiary");
  });

  test("test_geo_with_active_event_promotes_to_secondary", () => {
    expect(
      layerEmphasisTier(
        makeLayer({
          key: "geopolitical",
          status: "Neutral",
          geo: {
            impactSectorKey: "energy",
            impactSectorLabel: "Energy",
            stockExposureScore: 0.6,
            exposureBand: "moderate",
            exposureSummary: "Active sector exposure.",
            activeEvents: [{ event_type: "tariff", score: 0.5 }],
            eventDetails: []
          }
        })
      )
    ).toBe("secondary");
  });

  test("test_geo_with_live_events_flag_promotes_to_secondary", () => {
    expect(
      layerEmphasisTier(
        makeLayer({
          key: "geopolitical",
          status: "Neutral",
          geo: {
            impactSectorKey: "energy",
            impactSectorLabel: "Energy",
            stockExposureScore: 0,
            exposureBand: "low",
            exposureSummary: null,
            activeEvents: [],
            eventDetails: [],
            geoHasLiveEvents: true
          }
        })
      )
    ).toBe("secondary");
  });

  test("test_geo_bearish_status_promotes_to_secondary", () => {
    expect(
      layerEmphasisTier(
        makeLayer({
          key: "geopolitical",
          status: "Bearish",
          geo: {
            impactSectorKey: "energy",
            impactSectorLabel: "Energy",
            stockExposureScore: 0,
            exposureBand: "low",
            exposureSummary: null,
            activeEvents: [],
            eventDetails: []
          }
        })
      )
    ).toBe("secondary");
  });
});

describe("layerEmphasisTier — News / Macro / Internals default to secondary", () => {
  test("test_news_neutral_is_secondary", () => {
    expect(layerEmphasisTier(makeLayer({ key: "news", status: "Neutral" }))).toBe("secondary");
  });
  test("test_macro_neutral_is_secondary", () => {
    expect(layerEmphasisTier(makeLayer({ key: "macro", status: "Neutral" }))).toBe("secondary");
  });
  test("test_internals_neutral_is_secondary", () => {
    expect(layerEmphasisTier(makeLayer({ key: "internals", status: "Neutral" }))).toBe("secondary");
  });
  test("test_news_unavailable_demotes_to_tertiary", () => {
    expect(layerEmphasisTier(makeLayer({ key: "news", status: "Unavailable" }))).toBe("tertiary");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Section: layerHasActiveContent — per-layer truth table
// ─────────────────────────────────────────────────────────────────────

describe("layerHasActiveContent — Unavailable is never active", () => {
  test("test_unavailable_status_is_not_active_regardless_of_extras", () => {
    const layer = makeLayer({
      key: "macro",
      status: "Unavailable",
      macro_risk_level: "critical",
      macro_warnings: ["Big event"]
    });
    expect(layerHasActiveContent(layer)).toBe(false);
  });
});

describe("layerHasActiveContent — Technical is always active", () => {
  test("test_technical_neutral_is_active", () => {
    expect(layerHasActiveContent(makeLayer({ key: "technical", status: "Neutral" }))).toBe(true);
  });
});

describe("layerHasActiveContent — macro thresholds", () => {
  test("test_macro_critical_with_warnings_is_active", () => {
    expect(
      layerHasActiveContent(
        makeLayer({
          key: "macro",
          status: "Neutral",
          macro_risk_level: "critical",
          macro_warnings: ["FOMC at 14:00"]
        })
      )
    ).toBe(true);
  });

  test("test_macro_elevated_without_warnings_is_not_active", () => {
    expect(
      layerHasActiveContent(
        makeLayer({
          key: "macro",
          status: "Neutral",
          macro_risk_level: "elevated",
          macro_warnings: []
        })
      )
    ).toBe(false);
  });

  test("test_macro_imminent_event_is_active", () => {
    expect(
      layerHasActiveContent(
        makeLayer({
          key: "macro",
          status: "Neutral",
          upcoming_events: [
            {
              event_id: "e1",
              name: "CPI",
              category: "data",
              status: "imminent",
              importance: 0.9,
              hours_until: 0.5,
              warning: null,
              scheduled_time: "2026-05-13T12:30Z"
            }
          ]
        })
      )
    ).toBe(true);
  });

  test("test_macro_any_upcoming_event_is_active_even_when_status_is_upcoming", () => {
    // The macro card renders the "Upcoming" list at any event status,
    // not just imminent/today. The activity check must agree so the
    // render isn't hidden behind a default-collapsed <details> when
    // the user has 72h-away events worth seeing.
    expect(
      layerHasActiveContent(
        makeLayer({
          key: "macro",
          status: "Neutral",
          upcoming_events: [
            {
              event_id: "e1",
              name: "CPI",
              category: "data",
              status: "upcoming",
              importance: 0.6,
              hours_until: 72,
              warning: null,
              scheduled_time: "2026-05-15T12:30Z"
            }
          ]
        })
      )
    ).toBe(true);
  });

  test("test_macro_inverted_yield_curve_is_active", () => {
    expect(
      layerHasActiveContent(
        makeLayer({
          key: "macro",
          status: "Neutral",
          yield_curve: {
            yield_2yr: 4.5,
            yield_10yr: 4.0,
            spread: -0.5,
            regime: "inverted",
            label: "Inverted",
            chip: "Inverted curve"
          }
        })
      )
    ).toBe(true);
  });

  test("test_macro_normal_yield_curve_is_active", () => {
    // The macro card renders the yield-curve row at every regime
    // (normal → green, flat → amber, inverted → red). The user wants
    // to see a normal-regime curve as much as an inverted one, so the
    // activity check counts both.
    expect(
      layerHasActiveContent(
        makeLayer({
          key: "macro",
          status: "Neutral",
          yield_curve: {
            yield_2yr: 3.8,
            yield_10yr: 4.5,
            spread: 0.7,
            regime: "normal",
            label: "Yield curve: normal",
            chip: "2s10s: +0.70%"
          }
        })
      )
    ).toBe(true);
  });

  test("test_macro_truly_empty_is_not_active", () => {
    expect(layerHasActiveContent(makeLayer({ key: "macro", status: "Neutral" }))).toBe(false);
  });
});

describe("layerHasActiveContent — news thresholds", () => {
  test("test_news_with_upgrade_rating_is_active", () => {
    expect(
      layerHasActiveContent(
        makeLayer({
          key: "news",
          status: "Neutral",
          latest_rating: { action: "upgrade", rating: "Buy", firm: "Goldman", date: "2026-05-13" }
        })
      )
    ).toBe(true);
  });

  test("test_news_with_earnings_beat_is_active", () => {
    expect(
      layerHasActiveContent(
        makeLayer({
          key: "news",
          status: "Neutral",
          earnings_result: { beat: true, eps_surprise_pct: 5, period: "Q1" }
        })
      )
    ).toBe(true);
  });

  test("test_news_with_raised_guidance_is_active", () => {
    expect(
      layerHasActiveContent(
        makeLayer({
          key: "news",
          status: "Neutral",
          latest_guidance: { type: "raised", headline: "FY guidance up", date: "2026-05-13" }
        })
      )
    ).toBe(true);
  });

  test("test_news_with_wim_summary_is_active", () => {
    expect(
      layerHasActiveContent(
        makeLayer({ key: "news", status: "Neutral", wim_summary: "Berkshire announces tender" })
      )
    ).toBe(true);
  });

  test("test_news_truly_empty_is_not_active_BRK_B_regression", () => {
    // BRK.B screenshot regression: News was Neutral with no rating, no
    // earnings, no guidance, no WIM summary. Must NOT register as
    // active — that's the case that triggers the compressed Context
    // row.
    expect(
      layerHasActiveContent(makeLayer({ key: "news", status: "Neutral" }))
    ).toBe(false);
  });

  test("test_news_stale_zero_articles_counts_as_active", () => {
    // The card renders the "No qualifying news for ..." empty-state
    // copy in this case. The copy is content, so the layer must NOT
    // collapse and must NOT get folded into the compressed Context
    // card. The parenthetical still fires (decoupled — tested below).
    expect(
      layerHasActiveContent(
        makeLayer({
          key: "news",
          status: "Neutral",
          news_data_state: "stale",
          articles_count: 0
        })
      )
    ).toBe(true);
  });
});

describe("layerHasActiveContent — sector thresholds", () => {
  test("test_sector_unmapped_is_not_active", () => {
    expect(
      layerHasActiveContent(
        makeLayer({ key: "sector", status: "Neutral", sector_resolution_state: "unmapped" })
      )
    ).toBe(false);
  });

  test("test_sector_pending_cache_is_not_active", () => {
    expect(
      layerHasActiveContent(
        makeLayer({
          key: "sector",
          status: "Neutral",
          sector_resolution_state: "pending_cache_refresh"
        })
      )
    ).toBe(false);
  });

  test("test_sector_resolved_no_data_is_not_active", () => {
    expect(
      layerHasActiveContent(
        makeLayer({
          key: "sector",
          status: "Neutral",
          sector_resolution_state: "resolved",
          sector_data_available: false
        })
      )
    ).toBe(false);
  });

  test("test_sector_resolved_with_leading_sessions_is_active", () => {
    expect(
      layerHasActiveContent(
        makeLayer({
          key: "sector",
          status: "Neutral",
          sector_resolution_state: "resolved",
          sector_data_available: true,
          sector_sessions_leading: 3,
          sector_total_sessions: 5
        })
      )
    ).toBe(true);
  });
});

describe("layerHasActiveContent — geopolitical thresholds", () => {
  test("test_geo_no_extras_is_not_active", () => {
    expect(layerHasActiveContent(makeLayer({ key: "geopolitical", status: "Neutral" }))).toBe(
      false
    );
  });

  test("test_geo_with_active_events_is_active", () => {
    expect(
      layerHasActiveContent(
        makeLayer({
          key: "geopolitical",
          status: "Neutral",
          geo: {
            impactSectorKey: "energy",
            impactSectorLabel: "Energy",
            stockExposureScore: 0.4,
            exposureBand: "moderate",
            exposureSummary: null,
            activeEvents: [{ event_type: "tariff", score: 0.5 }],
            eventDetails: []
          }
        })
      )
    ).toBe(true);
  });

  test("test_geo_structural_baseline_summary_counts_as_active", () => {
    // GeoStructuralBaselinePanel renders meaningful copy when there's
    // a baseline summary, even without live events. The layer must
    // not be folded into the compressed Context card in this case —
    // the panel is real content.
    expect(
      layerHasActiveContent(
        makeLayer({
          key: "geopolitical",
          status: "Neutral",
          geo: {
            impactSectorKey: "semis",
            impactSectorLabel: "Semiconductors",
            stockExposureScore: null,
            exposureBand: "low",
            exposureSummary: null,
            activeEvents: [],
            eventDetails: [],
            geoBaselineScore: 30,
            geoBaselineSummary: "Semiconductor sector baseline copy.",
            geoHasLiveEvents: false
          }
        })
      )
    ).toBe(true);
  });

  test("test_geo_baseline_score_alone_counts_as_active", () => {
    // A non-null baseline score (even without summary text) renders
    // the band badge with meaningful color → still active content.
    expect(
      layerHasActiveContent(
        makeLayer({
          key: "geopolitical",
          status: "Neutral",
          geo: {
            impactSectorKey: "energy",
            impactSectorLabel: "Energy",
            stockExposureScore: null,
            exposureBand: "low",
            exposureSummary: null,
            activeEvents: [],
            eventDetails: [],
            geoBaselineScore: 12
          }
        })
      )
    ).toBe(true);
  });

  test("test_geo_only_sector_mapping_no_narrative_is_not_active", () => {
    // The case where the sector mapper resolved but there's nothing
    // structural to say — the baseline panel would render only the
    // bare badge with no narrative. Stays tertiary / compressible.
    expect(
      layerHasActiveContent(
        makeLayer({
          key: "geopolitical",
          status: "Neutral",
          geo: {
            impactSectorKey: "tech",
            impactSectorLabel: "Technology",
            stockExposureScore: 0,
            exposureBand: "low",
            exposureSummary: null,
            activeEvents: [],
            eventDetails: []
          }
        })
      )
    ).toBe(false);
  });
});

describe("layerHasActiveContent — internals + default", () => {
  test("test_internals_with_chips_is_active", () => {
    expect(
      layerHasActiveContent(
        makeLayer({ key: "internals", status: "Neutral", keyPoints: ["Breadth +", "VIX 14"] })
      )
    ).toBe(true);
  });

  test("test_internals_no_chips_is_not_active", () => {
    expect(layerHasActiveContent(makeLayer({ key: "internals", status: "Neutral" }))).toBe(false);
  });

  test("test_unknown_layer_with_2_plus_chips_is_active", () => {
    expect(
      layerHasActiveContent(
        makeLayer({ key: "future_layer_x", status: "Neutral", keyPoints: ["A", "B"] })
      )
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Section: isLayerCompressible — default-collapse rules
// ─────────────────────────────────────────────────────────────────────

describe("isLayerCompressible — Technical never collapses", () => {
  test("test_technical_neutral_does_not_collapse", () => {
    expect(isLayerCompressible(makeLayer({ key: "technical", status: "Neutral" }))).toBe(false);
  });
  test("test_technical_unavailable_does_not_collapse", () => {
    expect(isLayerCompressible(makeLayer({ key: "technical", status: "Unavailable" }))).toBe(false);
  });
});

describe("isLayerCompressible — directional layers never collapse", () => {
  test("test_bullish_news_does_not_collapse", () => {
    expect(isLayerCompressible(makeLayer({ key: "news", status: "Bullish" }))).toBe(false);
  });
  test("test_bearish_macro_does_not_collapse", () => {
    expect(isLayerCompressible(makeLayer({ key: "macro", status: "Bearish" }))).toBe(false);
  });
});

describe("isLayerCompressible — neutral + empty layers collapse", () => {
  test("test_news_neutral_empty_collapses_BRK_B_regression", () => {
    expect(isLayerCompressible(makeLayer({ key: "news", status: "Neutral" }))).toBe(true);
  });

  test("test_macro_neutral_empty_collapses", () => {
    expect(isLayerCompressible(makeLayer({ key: "macro", status: "Neutral" }))).toBe(true);
  });

  test("test_geo_neutral_empty_collapses", () => {
    expect(isLayerCompressible(makeLayer({ key: "geopolitical", status: "Neutral" }))).toBe(true);
  });

  test("test_sector_neutral_empty_collapses", () => {
    expect(isLayerCompressible(makeLayer({ key: "sector", status: "Neutral" }))).toBe(true);
  });

  test("test_neutral_layer_with_active_extras_does_not_collapse", () => {
    expect(
      isLayerCompressible(
        makeLayer({
          key: "news",
          status: "Neutral",
          earnings_result: { beat: true, eps_surprise_pct: 4, period: "Q1" }
        })
      )
    ).toBe(false);
  });

  test("test_unavailable_layer_collapses", () => {
    expect(isLayerCompressible(makeLayer({ key: "internals", status: "Unavailable" }))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Section: buildNewsNeutralParenthetical — copy invariants
// ─────────────────────────────────────────────────────────────────────

describe("buildNewsNeutralParenthetical — News=Neutral soft-negative reframe", () => {
  test("test_news_neutral_empty_returns_soft_negative_parenthetical", () => {
    const text = buildNewsNeutralParenthetical(makeLayer({ key: "news", status: "Neutral" }));
    expect(text).toBe("no catalyst support → lowers continuation probability");
  });

  test("test_news_bullish_returns_null", () => {
    expect(buildNewsNeutralParenthetical(makeLayer({ key: "news", status: "Bullish" }))).toBeNull();
  });

  test("test_news_bearish_returns_null", () => {
    expect(buildNewsNeutralParenthetical(makeLayer({ key: "news", status: "Bearish" }))).toBeNull();
  });

  test("test_news_neutral_with_earnings_beat_returns_null", () => {
    expect(
      buildNewsNeutralParenthetical(
        makeLayer({
          key: "news",
          status: "Neutral",
          earnings_result: { beat: true, eps_surprise_pct: 5, period: "Q1" }
        })
      )
    ).toBeNull();
  });

  test("test_news_stale_zero_articles_STILL_returns_parenthetical", () => {
    // The "stale + 0 articles" case lights up the empty-state copy
    // ("No qualifying news for ...") but it does NOT count as a
    // positive catalyst — the parenthetical and the empty-state copy
    // are complementary, not mutually exclusive. The user wants to
    // see both: data face on the layer ("no qualifying news") + the
    // implication parenthetical ("lowers continuation probability").
    expect(
      buildNewsNeutralParenthetical(
        makeLayer({
          key: "news",
          status: "Neutral",
          news_data_state: "stale",
          articles_count: 0
        })
      )
    ).toBe("no catalyst support → lowers continuation probability");
  });

  test("test_news_neutral_with_upgrade_rating_returns_null", () => {
    expect(
      buildNewsNeutralParenthetical(
        makeLayer({
          key: "news",
          status: "Neutral",
          latest_rating: { action: "upgrade", rating: "Buy", firm: "Goldman", date: "2026-05-13" }
        })
      )
    ).toBeNull();
  });

  test("test_news_neutral_with_raised_guidance_returns_null", () => {
    expect(
      buildNewsNeutralParenthetical(
        makeLayer({
          key: "news",
          status: "Neutral",
          latest_guidance: { type: "raised", headline: "FY guidance up", date: "2026-05-13" }
        })
      )
    ).toBeNull();
  });

  test("test_macro_neutral_returns_null", () => {
    expect(
      buildNewsNeutralParenthetical(makeLayer({ key: "macro", status: "Neutral" }))
    ).toBeNull();
  });

  test("test_news_unavailable_returns_null", () => {
    expect(
      buildNewsNeutralParenthetical(makeLayer({ key: "news", status: "Unavailable" }))
    ).toBeNull();
  });

  test("test_parenthetical_does_NOT_recommend_a_trade", () => {
    // Copy hygiene: the parenthetical must NOT shade into recommendation
    // language. It states a fact (no catalyst), names the mechanical
    // implication (lowers continuation probability), and stops there.
    const text = buildNewsNeutralParenthetical(makeLayer({ key: "news", status: "Neutral" }));
    expect(text).not.toBeNull();
    const lower = (text as string).toLowerCase();
    expect(lower).not.toContain("recommend");
    expect(lower).not.toContain("approved");
    expect(lower).not.toContain("avoid");
    expect(lower).not.toContain("don't");
    expect(lower).not.toContain("we suggest");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Section: shouldCompressContextLayers + buildCompressedContextSummary
// ─────────────────────────────────────────────────────────────────────

describe("shouldCompressContextLayers — strict 3-neutral gating", () => {
  const ctxLayers = () => [
    makeLayer({ key: "news", status: "Neutral" }),
    makeLayer({ key: "macro", status: "Neutral" }),
    makeLayer({ key: "geopolitical", status: "Neutral" })
  ];

  test("test_three_neutral_context_layers_compress_BRK_B_regression", () => {
    // Exact BRK.B screenshot situation: News + Macro + Geo all Neutral
    // with no active content. MUST compress.
    expect(shouldCompressContextLayers(ctxLayers())).toBe(true);
  });

  test("test_one_layer_bullish_breaks_compression", () => {
    const layers = ctxLayers();
    layers[0] = { ...layers[0], status: "Bullish" };
    expect(shouldCompressContextLayers(layers)).toBe(false);
  });

  test("test_one_layer_bearish_breaks_compression", () => {
    const layers = ctxLayers();
    layers[2] = { ...layers[2], status: "Bearish" };
    expect(shouldCompressContextLayers(layers)).toBe(false);
  });

  test("test_one_layer_active_content_breaks_compression", () => {
    const layers = ctxLayers();
    layers[1] = {
      ...layers[1],
      macro_risk_level: "critical",
      macro_warnings: ["FOMC at 14:00"]
    };
    expect(shouldCompressContextLayers(layers)).toBe(false);
  });

  test("test_missing_macro_layer_breaks_compression", () => {
    const layers = ctxLayers().filter((l) => l.key !== "macro");
    expect(shouldCompressContextLayers(layers)).toBe(false);
  });

  test("test_missing_news_layer_breaks_compression", () => {
    const layers = ctxLayers().filter((l) => l.key !== "news");
    expect(shouldCompressContextLayers(layers)).toBe(false);
  });

  test("test_extra_layers_around_three_neutrals_still_compress", () => {
    const layers = [
      ...ctxLayers(),
      makeLayer({ key: "technical", status: "Bullish" }),
      makeLayer({ key: "internals", status: "Neutral" }),
      makeLayer({ key: "sector", status: "Bearish" })
    ];
    // Compression only cares about the three context layers; technical,
    // internals, and sector are not in the cluster.
    expect(shouldCompressContextLayers(layers)).toBe(true);
  });
});

describe("buildCompressedContextSummary — payload shape", () => {
  const ctxLayers = () => [
    makeLayer({ key: "news", status: "Neutral" }),
    makeLayer({ key: "macro", status: "Neutral" }),
    makeLayer({ key: "geopolitical", status: "Neutral" })
  ];

  test("test_summary_returns_consolidated_card_payload", () => {
    const out = buildCompressedContextSummary(ctxLayers());
    expect(out).not.toBeNull();
    expect(out!.title).toBe("Context");
    expect(out!.statusLabel).toBe("Neutral");
    expect(out!.collapsedLayerKeys).toEqual(["news", "macro", "geopolitical"]);
    expect(out!.layers).toHaveLength(3);
  });

  test("test_summary_headline_uses_data_only_copy", () => {
    const out = buildCompressedContextSummary(ctxLayers());
    expect(out!.headline).toBe("Neutral (no macro or news tailwinds present)");
    const lower = out!.headline.toLowerCase();
    // No advice language sneaking into the summary card copy.
    expect(lower).not.toContain("recommend");
    expect(lower).not.toContain("avoid");
    expect(lower).not.toContain("approved");
  });

  test("test_summary_returns_null_when_a_layer_is_missing", () => {
    // Defensive: even though the caller is supposed to gate on
    // shouldCompressContextLayers first, the function must degrade
    // safely if it's called with a partial layer set.
    const partial = ctxLayers().filter((l) => l.key !== "macro");
    expect(buildCompressedContextSummary(partial)).toBeNull();
  });
});
