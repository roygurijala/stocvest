/**
 * Render-level tests for B36 — Signal Price drift row on the evidence
 * card (BRK.B follow-up, 2026-05-13).
 *
 * The pure display helper is locked in by
 * `tests/signal-price-display.test.ts`. This file lights up the full
 * `SignalEvidenceCard` and asserts the actual DOM under the scenarios
 * that matter for the BRK.B feedback:
 *
 *   1. Both prices present + meaningful Δ → the row renders with the
 *      computed-at price, current price, signed Δ%, and the matching
 *      drift-tier color class.
 *
 *   2. Only `priceAtSignal` (no live snapshot) → partial row renders
 *      with a "current price n/a" placeholder and no Δ.
 *
 *   3. Only `lastTradePrice` (no scanner row price) → partial row
 *      renders with a "computed-at price n/a" placeholder.
 *
 *   4. Neither price → the row is omitted entirely (no empty
 *      placeholder, no zero-width artifact).
 *
 *   5. The drift-tier `data-drift-tier` attribute reflects the band
 *      so visual regression tooling and a11y assertions have a
 *      stable selector.
 *
 *   6. The accessible label is set on the row container so screen
 *      readers read a single sentence describing the drift.
 *
 *   7. The row passes through `setup.last_price` via
 *      `buildEvidenceFromSetup` — the BRK.B-scenario lock-in that
 *      proves the data path works end-to-end without any backend
 *      changes.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { SignalEvidenceCard } from "@/components/signal-evidence-card";
import { ThemeProvider } from "@/lib/theme-provider";
import { UserProfileProvider } from "@/lib/user-profile-context";
import { buildEvidenceFromSetup } from "@/lib/signal-evidence";
import type { IntradaySetupPayload } from "@/lib/api/scanner";
import type { SignalEvidenceData } from "@/lib/signal-evidence";

function renderEvidence(evidence: SignalEvidenceData): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      null,
      createElement(
        UserProfileProvider,
        { value: { profile: null, loaded: true } },
        createElement(SignalEvidenceCard, { evidence })
      )
    )
  );
}

function evidenceWithPrices(
  priceAtSignal: number | null,
  lastTradePrice: number | null,
  overrides: Partial<IntradaySetupPayload> = {}
): SignalEvidenceData {
  const setup: IntradaySetupPayload = {
    symbol: "BRK.B",
    direction: "bullish",
    score: 0.62,
    triggers: ["Test"],
    timestamp_iso: new Date().toISOString(),
    last_price: priceAtSignal ?? undefined,
    ...overrides
  };
  const snap =
    lastTradePrice != null
      ? {
          symbol: "BRK.B",
          last_trade_price: lastTradePrice,
          prev_close: lastTradePrice,
          day_vwap: lastTradePrice
        }
      : undefined;
  // The price-at-signal field flows in from `setup.last_price` via
  // `buildEvidenceFromSetup`; the current price flows in from the
  // snapshot. We rely on that wiring directly so this test catches
  // any regression in the data path, not just the render path.
  return buildEvidenceFromSetup(setup, snap as never, { symbolNewsArticles: [] });
}

// ─────────────────────────────────────────────────────────────────────
// Section 1: BRK.B happy-path regression
// ─────────────────────────────────────────────────────────────────────

describe("Signal Price drift row — BRK.B happy-path regression", () => {
  test("test_BRK_B_drift_row_renders_with_both_prices_and_delta", () => {
    // Exact reproduction of the user's BRK.B feedback:
    //   Computed at: $503.60 / Current: $509.20 / Δ +1.1%
    const html = renderEvidence(evidenceWithPrices(503.6, 509.2));
    expect(html).toContain('data-testid="signal-evidence-price-drift"');
    expect(html).toContain('data-testid="signal-evidence-price-drift-at-signal"');
    expect(html).toContain('data-testid="signal-evidence-price-drift-current"');
    expect(html).toContain('data-testid="signal-evidence-price-drift-delta"');
    expect(html).toContain("$503.60");
    expect(html).toContain("$509.20");
    expect(html).toContain("+1.1%");
  });

  test("test_BRK_B_drift_row_bands_to_moderate_tier", () => {
    const html = renderEvidence(evidenceWithPrices(503.6, 509.2));
    expect(html).toContain('data-drift-tier="moderate"');
  });

  test("test_BRK_B_drift_row_sets_accessible_label", () => {
    const html = renderEvidence(evidenceWithPrices(503.6, 509.2));
    // aria-label is HTML-escaped on the row container; we assert the
    // load-bearing fragments rather than the full sentence so future
    // copy tweaks don't trip the test.
    expect(html).toContain("Signal computed at $503.60");
    expect(html).toContain("Current price $509.20");
    expect(html).toContain("Drift up 1.1 percent");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Section 2: Drift-tier color bands
// ─────────────────────────────────────────────────────────────────────

describe("Signal Price drift row — tier banding", () => {
  test("test_zero_drift_bands_to_none", () => {
    const html = renderEvidence(evidenceWithPrices(500, 500));
    expect(html).toContain('data-drift-tier="none"');
  });

  test("test_sub_one_percent_drift_bands_to_marginal", () => {
    const html = renderEvidence(evidenceWithPrices(500, 502));
    expect(html).toContain('data-drift-tier="marginal"');
  });

  test("test_three_to_five_percent_bands_to_elevated", () => {
    const html = renderEvidence(evidenceWithPrices(500, 520));
    expect(html).toContain('data-drift-tier="elevated"');
  });

  test("test_above_five_percent_bands_to_stale", () => {
    const html = renderEvidence(evidenceWithPrices(500, 540));
    expect(html).toContain('data-drift-tier="stale"');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Section 3: Defensive rendering — partial / missing data
// ─────────────────────────────────────────────────────────────────────

describe("Signal Price drift row — defensive rendering", () => {
  test("test_only_priceAtSignal_renders_partial_row_with_n_a_placeholder", () => {
    const html = renderEvidence(evidenceWithPrices(503.6, null));
    expect(html).toContain('data-testid="signal-evidence-price-drift"');
    expect(html).toContain("$503.60");
    expect(html).toContain("current price n/a");
    // Δ must NOT render when only one side is present — no spurious
    // "Δ 0.0%" or arrow.
    expect(html).not.toContain('data-testid="signal-evidence-price-drift-delta"');
  });

  test("test_only_currentPrice_renders_partial_row_with_n_a_placeholder", () => {
    const html = renderEvidence(evidenceWithPrices(null, 509.2));
    expect(html).toContain('data-testid="signal-evidence-price-drift"');
    expect(html).toContain("$509.20");
    expect(html).toContain("computed-at price n/a");
    expect(html).not.toContain('data-testid="signal-evidence-price-drift-delta"');
  });

  test("test_no_prices_omits_row_entirely", () => {
    const html = renderEvidence(evidenceWithPrices(null, null));
    expect(html).not.toContain('data-testid="signal-evidence-price-drift"');
  });

  test("test_invalid_priceAtSignal_zero_omits_left_side_only", () => {
    // Setup row carries `last_price: 0` (data quality issue). The
    // helper sanitizes it to null and we render the partial row.
    const html = renderEvidence(evidenceWithPrices(0, 509.2));
    expect(html).toContain("computed-at price n/a");
    expect(html).toContain("$509.20");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Section 4: Data-path wiring — setup.last_price → priceAtSignal
// ─────────────────────────────────────────────────────────────────────

describe("Signal Price drift row — buildEvidenceFromSetup wiring", () => {
  test("test_setup_last_price_propagates_to_priceAtSignal", () => {
    // The wiring is what makes this whole feature work without a
    // backend change. Pin it.
    const setup: IntradaySetupPayload = {
      symbol: "TEST",
      direction: "bullish",
      score: 0.62,
      triggers: ["Test"],
      timestamp_iso: new Date().toISOString(),
      last_price: 123.45
    };
    const ev = buildEvidenceFromSetup(setup, undefined, { symbolNewsArticles: [] });
    expect(ev.priceAtSignal).toBe(123.45);
  });

  test("test_missing_setup_last_price_yields_null_priceAtSignal", () => {
    const setup: IntradaySetupPayload = {
      symbol: "TEST",
      direction: "bullish",
      score: 0.62,
      triggers: ["Test"],
      timestamp_iso: new Date().toISOString()
    };
    const ev = buildEvidenceFromSetup(setup, undefined, { symbolNewsArticles: [] });
    expect(ev.priceAtSignal ?? null).toBeNull();
  });

  test("test_zero_setup_last_price_sanitizes_to_null_priceAtSignal", () => {
    const setup: IntradaySetupPayload = {
      symbol: "TEST",
      direction: "bullish",
      score: 0.62,
      triggers: ["Test"],
      timestamp_iso: new Date().toISOString(),
      last_price: 0
    };
    const ev = buildEvidenceFromSetup(setup, undefined, { symbolNewsArticles: [] });
    expect(ev.priceAtSignal ?? null).toBeNull();
  });

  test("test_negative_setup_last_price_sanitizes_to_null_priceAtSignal", () => {
    const setup: IntradaySetupPayload = {
      symbol: "TEST",
      direction: "bullish",
      score: 0.62,
      triggers: ["Test"],
      timestamp_iso: new Date().toISOString(),
      last_price: -1
    };
    const ev = buildEvidenceFromSetup(setup, undefined, { symbolNewsArticles: [] });
    expect(ev.priceAtSignal ?? null).toBeNull();
  });
});
