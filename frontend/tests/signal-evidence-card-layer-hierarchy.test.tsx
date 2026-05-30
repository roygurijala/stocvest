/**
 * Render-level tests for B35 — layer-card hierarchy + context
 * compression + News-neutral parenthetical (BRK.B follow-up,
 * 2026-05-13).
 *
 * The pure helpers are tested separately in
 * `tests/layer-emphasis.test.ts`. This file lights up the actual
 * `SignalEvidenceCard` and asserts the user-visible DOM behaves
 * correctly under the four scenarios that matter:
 *
 *   1. BRK.B regression — News + Macro + Geopolitical all Neutral
 *      with nothing actionable → consolidated "Context" card replaces
 *      the three full-size layer cards.
 *
 *   2. Any context layer goes directional → the consolidated card
 *      disappears and the three layers render individually.
 *
 *   3. The News-neutral parenthetical ("no catalyst support → lowers
 *      continuation probability") shows up alongside a News=Neutral
 *      chip when News has no positive catalyst.
 *
 *   4. The Technical layer always renders at `primary` tier and never
 *      collapses — this is the load-bearing layer for the Decision.
 *
 * Tests use `renderToStaticMarkup` against the full card with the
 * default `buildEvidenceFromSetup` payload (matches what the engine
 * actually emits) so future ranking / tier changes that subtly break
 * the cluster trip these regressions.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { SignalEvidenceCard } from "@/components/signal-evidence-card";
import { ThemeProvider } from "@/lib/theme-provider";
import { UserProfileProvider } from "@/lib/user-profile-context";
import { applySwingCompositeEnrichment, buildEvidenceFromSetup } from "@/lib/signal-evidence";
import type { IntradaySetupPayload } from "@/lib/api/scanner";

const baseSetup: IntradaySetupPayload = {
  symbol: "BRK.B",
  direction: "bullish",
  score: 0.62,
  triggers: ["Test"],
  timestamp_iso: new Date().toISOString()
};

function renderCard(enrichmentBody: Record<string, unknown>): string {
  const base = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
  const enriched = applySwingCompositeEnrichment(base, enrichmentBody);
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      null,
      createElement(
        UserProfileProvider,
        { value: { profile: null, loaded: true } },
        createElement(SignalEvidenceCard, { evidence: enriched })
      )
    )
  );
}

const NEUTRAL_INSIGHT_BODY = {
  signal_score: 60,
  trend_strength: "Moderate",
  trend_direction: "Uptrend",
  risk_reward: 2.5,
  market_regime: "Neutral",
  catalysts: [],
  risk_factors: [],
  signal_parameters: "x",
  historical_entry_zone: { low: 480, high: 490 }
};

// ─────────────────────────────────────────────────────────────────────
// Section 1: BRK.B regression — three context neutrals compress
// ─────────────────────────────────────────────────────────────────────

describe("Signal Evidence Card — context compression (BRK.B regression)", () => {
  test("test_three_neutral_context_layers_collapse_into_Context_card", () => {
    // The default 6 layers `buildEvidenceFromSetup` emits are all
    // Neutral with no rich extras until enrichment fills them in. With
    // an empty enrichment body, News + Macro + Geopolitical all stay
    // Neutral with no active content → must compress.
    const html = renderCard(NEUTRAL_INSIGHT_BODY);

    // Consolidated card is present.
    expect(html).toContain('data-testid="layer-compressed-context"');
    // Headline reads the data-only copy.
    expect(html).toContain("Neutral (no macro or news tailwinds present)");
    // The collapsed-layer-keys attribute pins the three layers folded in.
    expect(html).toContain('data-collapsed-layer-keys="news,macro,geopolitical"');
    // The three individual layer cards must NOT render at top level.
    expect(html).not.toContain('data-testid="layer-card-news"');
    expect(html).not.toContain('data-testid="layer-card-macro"');
    expect(html).not.toContain('data-testid="layer-card-geopolitical"');
    // The `<details>` disclosure exists with the inner mini-summaries.
    expect(html).toContain('data-testid="layer-compressed-context-details"');
    expect(html).toContain('data-testid="layer-compressed-context-inner-news"');
    expect(html).toContain('data-testid="layer-compressed-context-inner-macro"');
    expect(html).toContain('data-testid="layer-compressed-context-inner-geopolitical"');
  });

  test("test_compressed_card_keeps_inner_layer_explanations_for_disclosure", () => {
    const html = renderCard(NEUTRAL_INSIGHT_BODY);
    // Each inner mini-summary carries user-facing verdict copy (not internal scores).
    expect(html).toMatch(/no strong catalyst either way/);
    expect(html).toMatch(/mixed without a strong directional push/);
    expect(html).toMatch(/External risk events are monitored/);
  });

  test("test_summary_copy_is_data_only_no_advice_words", () => {
    const html = renderCard(NEUTRAL_INSIGHT_BODY);
    // Lock in that the consolidated headline does NOT shade into advice.
    const lower = html.toLowerCase();
    const idx = lower.indexOf("layer-compressed-context-headline");
    expect(idx).toBeGreaterThan(-1);
    // Forbid advice language anywhere in the rendered card (broader sweep).
    expect(lower).not.toContain("we recommend");
    expect(lower).not.toContain("we advise");
    expect(lower).not.toContain("you should avoid");
    expect(lower).not.toContain("approved trade");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Section 2: Compression breaks when any context layer goes directional
// ─────────────────────────────────────────────────────────────────────

describe("Signal Evidence Card — compression un-collapses when news flips bullish", () => {
  test("test_news_bullish_breaks_compression", () => {
    // Inject a news layer with an upgrade rating so it renders Bullish
    // with active content. The compressed Context card MUST disappear.
    const html = renderCard({
      ...NEUTRAL_INSIGHT_BODY,
      layers: [
        {
          layer: "news",
          verdict: "bullish",
          score: 70,
          status: "available",
          reasoning: "News",
          latest_rating: {
            action: "upgrade",
            rating: "Buy",
            firm: "Goldman",
            date: "2026-05-13"
          }
        }
      ]
    });
    expect(html).not.toContain('data-testid="layer-compressed-context"');
    // The individual news layer renders directly instead.
    expect(html).toContain('data-testid="layer-card-news"');
  });

  test("test_macro_with_imminent_event_breaks_compression", () => {
    // Even with macro=Neutral, an imminent event is "active content"
    // and the user needs the full macro card visible. Compression must
    // not eat it.
    const html = renderCard({
      ...NEUTRAL_INSIGHT_BODY,
      layers: [
        {
          layer: "macro",
          verdict: "neutral",
          score: 50,
          status: "available",
          reasoning: "Macro",
          macro_risk_level: "critical",
          macro_warnings: ["FOMC at 14:00 — high impact"],
          upcoming_events: [
            {
              event_id: "e1",
              name: "FOMC",
              category: "policy",
              status: "imminent",
              importance: 0.95,
              hours_until: 0.5,
              warning: null,
              scheduled_time: "2026-05-13T18:00:00Z"
            }
          ]
        }
      ]
    });
    expect(html).not.toContain('data-testid="layer-compressed-context"');
    expect(html).toContain('data-testid="layer-card-macro"');
    // The critical-event banner is visible (not collapsed).
    expect(html).toContain("FOMC at 14:00");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Section 3: News-neutral soft-negative parenthetical
// ─────────────────────────────────────────────────────────────────────

describe("Signal Evidence Card — News=Neutral parenthetical", () => {
  test("test_news_neutral_parenthetical_renders_when_news_is_solo_neutral", () => {
    // We need a scenario where the News layer renders STANDALONE
    // (compression off) but is still Neutral with no active content.
    // Simplest: a layer set where one of the other context layers
    // (macro) is bullish — that breaks compression — but news stays
    // Neutral and empty.
    const html = renderCard({
      ...NEUTRAL_INSIGHT_BODY,
      layers: [
        // Macro bullish breaks the 3-layer compression…
        {
          layer: "macro",
          verdict: "bullish",
          score: 70,
          status: "available",
          reasoning: "Macro",
          yield_curve: {
            yield_2yr: 3.5,
            yield_10yr: 4.5,
            spread: 1.0,
            regime: "normal",
            label: "Yield curve: normal",
            chip: "2s10s: +1.00%"
          }
        }
        // …and the News layer falls back to its `buildEvidenceFromSetup`
        // default which is Neutral with no rich extras → parenthetical
        // fires.
      ]
    });

    expect(html).not.toContain('data-testid="layer-compressed-context"');
    // The standalone news card carries the soft-negative parenthetical.
    expect(html).toContain('data-testid="layer-news-neutral-parenthetical"');
    expect(html).toContain("no catalyst support → lowers continuation probability");
  });

  test("test_news_bullish_suppresses_parenthetical", () => {
    const html = renderCard({
      ...NEUTRAL_INSIGHT_BODY,
      layers: [
        {
          layer: "news",
          verdict: "bullish",
          score: 70,
          status: "available",
          reasoning: "News",
          latest_rating: {
            action: "upgrade",
            rating: "Buy",
            firm: "Goldman",
            date: "2026-05-13"
          }
        }
      ]
    });
    // Even though News is the only override, all other context layers
    // are still Neutral defaults — context compression should NOT fire
    // because news is bullish, so the layer breakdown is uncompressed
    // and we can search for parenthetical attributes.
    expect(html).not.toContain('data-testid="layer-news-neutral-parenthetical"');
    expect(html).not.toContain("no catalyst support");
  });

  test("test_news_neutral_with_active_content_suppresses_parenthetical", () => {
    // News status stays Neutral, but an earnings beat is active content
    // — the soft-negative parenthetical would be misleading because
    // there IS catalyst support, just not directional. Suppress it.
    const html = renderCard({
      ...NEUTRAL_INSIGHT_BODY,
      layers: [
        {
          layer: "macro",
          verdict: "bullish",
          score: 70,
          status: "available",
          reasoning: "Macro",
          yield_curve: {
            yield_2yr: 3.5,
            yield_10yr: 4.5,
            spread: 1.0,
            regime: "normal",
            label: "Yield curve: normal",
            chip: "2s10s: +1.00%"
          }
        },
        {
          layer: "news",
          verdict: "neutral",
          score: 50,
          status: "available",
          reasoning: "News",
          earnings_result: { beat: true, eps_surprise_pct: 5, period: "Q1" }
        }
      ]
    });
    expect(html).not.toContain('data-testid="layer-news-neutral-parenthetical"');
    expect(html).not.toContain("no catalyst support");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Section 4: Tier invariants
// ─────────────────────────────────────────────────────────────────────

describe("Signal Evidence Card — emphasis-tier invariants", () => {
  test("test_technical_always_renders_at_primary_tier", () => {
    const html = renderCard(NEUTRAL_INSIGHT_BODY);
    expect(html).toMatch(
      /data-testid="layer-card-technical"[^>]*data-layer-tier="primary"/
    );
    // Technical is never compressible.
    expect(html).toMatch(
      /data-testid="layer-card-technical"[^>]*data-layer-compressible="false"/
    );
  });

  test("test_sector_neutral_renders_at_tertiary_tier_and_compressible", () => {
    const html = renderCard(NEUTRAL_INSIGHT_BODY);
    expect(html).toMatch(
      /data-testid="layer-card-sector"[^>]*data-layer-tier="tertiary"/
    );
    expect(html).toMatch(
      /data-testid="layer-card-sector"[^>]*data-layer-compressible="true"/
    );
    // Body wrapped in <details> with the canonical "Show evaluation detail" summary.
    expect(html).toContain('data-testid="layer-sector-collapsed"');
  });

  test("test_internals_neutral_renders_at_secondary_tier", () => {
    const html = renderCard(NEUTRAL_INSIGHT_BODY);
    expect(html).toMatch(
      /data-testid="layer-card-internals"[^>]*data-layer-tier="secondary"/
    );
  });

  test("test_summary_link_uses_show_evaluation_detail_copy", () => {
    // Lock in the disclosure summary label so future copy edits are
    // intentional.
    const html = renderCard(NEUTRAL_INSIGHT_BODY);
    expect(html).toContain("Show evaluation detail");
    expect(html).toContain("Show News, Macro, and Geopolitical layer detail");
  });
});
