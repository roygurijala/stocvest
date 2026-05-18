import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LandingPerformanceSection } from "@/components/landing-performance-section";
import {
  PerformanceTrackingContent,
  PublicValidationSection
} from "@/components/performance-tracking-content";
import { ThemeProvider } from "@/lib/theme-provider";
import type { PerformanceSummary } from "@/lib/api/public-signals";
import type { PublicHistoricalValidationResponse } from "@/lib/api/historical-validation";

// Lock-in tests for the Mode Separation rule (assistant_prompts.py):
// "Never headline a combined accuracy or result across Day and Swing."
//
// These three surfaces (homepage landing, /performance dashboard top row,
// /performance public validation block) previously each surfaced a single
// combined-engine accuracy number. The fixes remove those combined headlines
// and surface per-engine numbers (Swing track / Day track) instead. These
// tests guard the structural absence of combined-engine wording so a future
// regression cannot silently re-introduce a "system overall" hero.

const HEAVY_PATTERN_FREE_SUMMARY: PerformanceSummary = {
  service_name: "test",
  launch_date: "2026-04-01",
  total_signals_tracked: 12,
  correct_direction_count: 7,
  incorrect_direction_count: 3,
  signals_evaluated: 10,
  directional_accuracy_percent: 70,
  pattern_breakdown: []
};

const PUBLIC_VALIDATION_PAYLOAD: PublicHistoricalValidationResponse = {
  horizon: "1d",
  from: "2026-02-09T00:00:00.000Z",
  to: "2026-05-10T00:00:00.000Z",
  mode: null,
  disclaimer: "Historical signal accuracy does not guarantee future results.",
  summary: {
    horizon: "1d",
    overall: { total_signals: 5, correct: 3, incorrect: 2, neutral: 0, resolved: 5, accuracy: 0.6 },
    by_mode: {
      swing: { total_signals: 3, correct: 2, incorrect: 1, neutral: 0, resolved: 3, accuracy: 2 / 3 },
      day: { total_signals: 2, correct: 1, incorrect: 1, neutral: 0, resolved: 2, accuracy: 0.5 }
    },
    rows_examined: 5
  }
};

describe("LandingPerformanceSection (homepage)", () => {
  test("does NOT surface a combined-engine 'Overall directional accuracy' headline", () => {
    const html = renderToStaticMarkup(
      createElement(LandingPerformanceSection, { summary: HEAVY_PATTERN_FREE_SUMMARY })
    );
    // The old line was literally
    //   "Overall directional accuracy (resolved 1d): 70.0% · n=10"
    // — a combined-engine claim on the LOGGED-OUT homepage. It must be gone.
    expect(html).not.toMatch(/Overall directional accuracy/i);
    // And the bare number must not leak into the rendered text either.
    expect(html).not.toContain("70.0%");
  });

  test("renders a per-engine handoff line that points users at the segmented report", () => {
    const html = renderToStaticMarkup(
      createElement(LandingPerformanceSection, { summary: HEAVY_PATTERN_FREE_SUMMARY })
    );
    // The replacement line is allowed to mention the resolved count (a
    // mode-agnostic VOLUME number, not an accuracy claim) and must point
    // users at the per-engine track records.
    expect(html).toContain("Resolved 1d signals so far");
    expect(html).toMatch(/Per-engine accuracy.*Swing.*Day/i);
  });
});

describe("PerformanceTrackingContent — Validation ledger link (Phase 2c)", () => {
  // The Signal Validation Ledger was moved off the dashboard onto the
  // Performance page. Per the user directive ("a data element belongs in
  // Shared Context if and only if it answers what kind of market environment
  // are all traders operating in"), tracked outcomes are NOT shared context.
  // The Performance page is the correct home; these tests lock in that
  // location contract and the logged-out / logged-in gating.

  test("logged-in Performance page renders the ledger link surface", () => {
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(PerformanceTrackingContent, { showHomeLink: false })
      )
    );
    expect(html).toContain("performance-validation-ledger-link");
    expect(html).toContain("Open setup outcomes (Swing / Day)");
    expect(html).toContain("/dashboard/setup-outcomes");
    // Mode Separation reminder must surface so a user opening the ledger
    // for the first time understands Swing ≠ Day before they read numbers.
    expect(html).toMatch(/Mode Separation/);
  });

  test("logged-out public Performance mirror does NOT render the ledger link", () => {
    // The Performance mirror is gated behind login at the API layer
    // (Phase 3c-1 backend). The UI must match: when `showHomeLink=true`
    // (homepage `/performance` route), the stratified ledger surface must
    // be absent so the LOGGED-OUT golden rule ("explain the FRAMEWORK,
    // not the DECISION") is preserved at the rendering layer too.
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(PerformanceTrackingContent, { showHomeLink: true })
      )
    );
    expect(html).not.toContain("performance-validation-ledger-link");
    expect(html).not.toContain("Open full ledger (Swing / Day)");
  });
});

describe("PerformanceTrackingContent (dashboard /performance top row)", () => {
  test("top metric row does NOT include a combined 'Directional Accuracy' card", () => {
    // renderToStaticMarkup runs the component without effects, so the data
    // fetches never fire — but the top row of metrics is rendered
    // unconditionally and is what we care about here.
    const html = renderToStaticMarkup(
      createElement(ThemeProvider, null, createElement(PerformanceTrackingContent, { showHomeLink: false }))
    );
    // The legacy top row had a card labelled "Directional Accuracy" right
    // next to "Total Signals". That card averaged across engines and is the
    // exact thing the rule bans.
    expect(html).not.toMatch(/Directional Accuracy/);
    // Sanity: the other cards are still there.
    expect(html).toContain("Total Signals");
    expect(html).toContain("Signals Evaluated");
    expect(html).toContain("Tracking Since");
  });
});

describe("PublicValidationSection (90-day historical mirror)", () => {
  test("does NOT render a combined 'Overall accuracy (1d)' card; renders Swing + Day only", () => {
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(PublicValidationSection, {
          validation: PUBLIC_VALIDATION_PAYLOAD,
          surfaceClass: "test-surface",
          panelStyle: { background: "#000", border: "1px solid #333", borderRadius: "8px", padding: "16px" },
          metricCardStyle: { background: "#111", border: "1px solid #444", borderRadius: "8px", padding: "12px" },
          // ThemeProvider supplies its own `colors` but PublicValidationSection
          // also expects an explicit `colors` prop. We rebuild the minimal
          // surface the component touches: text + textMuted.
          colors: {
            text: "#fff",
            textMuted: "#aaa"
          } as unknown as Parameters<typeof PublicValidationSection>[0]["colors"]
        })
      )
    );
    expect(html).not.toMatch(/Overall accuracy/i);
    // Both per-engine cards must still be present, with their cadence labels
    // — pinned to the canonical SUBHEADING_*_CADENCE constants from
    // `lib/mode-terminology`. A rename there would intentionally trip
    // this test as a copy-edit-aware safety net.
    expect(html).toMatch(/Swing \(multi-day cadence\)/);
    expect(html).toMatch(/Day \(intraday cadence\)/);
    // Numbers from the fixture must surface in the rendered output so we
    // know the cards are wired to the by_mode buckets, not just rendered as
    // empty placeholders.
    expect(html).toMatch(/66\.7%/); // swing accuracy = 2/3
    expect(html).toMatch(/50\.0%/); // day accuracy = 0.5
  });
});
