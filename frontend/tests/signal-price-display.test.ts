/**
 * Lock-in tests for the Signal Price drift display helper
 * (B36, 2026-05-13).
 *
 * Pure helper; no React, no fetch. These tests pin:
 *
 *   - The exact drift-tier boundaries (1% / 3% / 5%)
 *   - Direction-agnostic delta (positive Δ doesn't mean "good")
 *   - Defensive handling of every degenerate price shape (missing,
 *     NaN, zero, negative, Infinity)
 *   - The accessible-label sentence shape (load-bearing for screen
 *     readers — they read this verbatim)
 *   - The percent and price formatting helpers
 */

import { describe, expect, test } from "vitest";

import {
  computeSignalPriceDisplay,
  formatSignalPrice,
  formatSignalPriceDeltaPct,
  signalPriceDriftTier
} from "@/lib/signal-evidence/signal-price-display";

// ─────────────────────────────────────────────────────────────────────
// Section 1: signalPriceDriftTier — band boundaries
// ─────────────────────────────────────────────────────────────────────

describe("signalPriceDriftTier — band boundaries", () => {
  test("test_zero_delta_is_none", () => {
    expect(signalPriceDriftTier(0)).toBe("none");
  });

  test("test_below_one_percent_is_marginal", () => {
    expect(signalPriceDriftTier(0.4)).toBe("marginal");
    expect(signalPriceDriftTier(-0.9)).toBe("marginal");
    expect(signalPriceDriftTier(0.999)).toBe("marginal");
  });

  test("test_exactly_one_percent_is_moderate", () => {
    expect(signalPriceDriftTier(1.0)).toBe("moderate");
    expect(signalPriceDriftTier(-1.0)).toBe("moderate");
  });

  test("test_one_to_three_percent_is_moderate", () => {
    expect(signalPriceDriftTier(1.5)).toBe("moderate");
    expect(signalPriceDriftTier(2.9)).toBe("moderate");
    expect(signalPriceDriftTier(-2.5)).toBe("moderate");
  });

  test("test_exactly_three_percent_is_elevated", () => {
    expect(signalPriceDriftTier(3.0)).toBe("elevated");
    expect(signalPriceDriftTier(-3.0)).toBe("elevated");
  });

  test("test_three_to_five_percent_is_elevated", () => {
    expect(signalPriceDriftTier(3.5)).toBe("elevated");
    expect(signalPriceDriftTier(4.99)).toBe("elevated");
    expect(signalPriceDriftTier(-4.5)).toBe("elevated");
  });

  test("test_exactly_five_percent_is_stale", () => {
    expect(signalPriceDriftTier(5.0)).toBe("stale");
    expect(signalPriceDriftTier(-5.0)).toBe("stale");
  });

  test("test_above_five_percent_is_stale", () => {
    expect(signalPriceDriftTier(7.5)).toBe("stale");
    expect(signalPriceDriftTier(20)).toBe("stale");
    expect(signalPriceDriftTier(-12.3)).toBe("stale");
  });

  test("test_tier_is_direction_agnostic_BRK_B_intent", () => {
    // The user's framing is that drift magnitude matters, not sign.
    // +1.1% drift on a long is "small tailwind"; +1.1% drift on a
    // short is "small headwind." Both should bucket identically —
    // the helper bands on magnitude only.
    expect(signalPriceDriftTier(1.1)).toBe(signalPriceDriftTier(-1.1));
    expect(signalPriceDriftTier(4.2)).toBe(signalPriceDriftTier(-4.2));
    expect(signalPriceDriftTier(8)).toBe(signalPriceDriftTier(-8));
  });
});

// ─────────────────────────────────────────────────────────────────────
// Section 2: formatSignalPrice + formatSignalPriceDeltaPct
// ─────────────────────────────────────────────────────────────────────

describe("formatSignalPrice — two-decimal USD display", () => {
  test("test_round_dollars_get_two_decimals", () => {
    expect(formatSignalPrice(503)).toBe("$503.00");
    expect(formatSignalPrice(0.5)).toBe("$0.50");
  });

  test("test_three_decimal_input_rounds_to_two", () => {
    expect(formatSignalPrice(503.604)).toBe("$503.60");
    expect(formatSignalPrice(503.606)).toBe("$503.61");
  });

  test("test_BRK_B_user_example_values_format_correctly", () => {
    expect(formatSignalPrice(503.6)).toBe("$503.60");
    expect(formatSignalPrice(509.2)).toBe("$509.20");
  });
});

describe("formatSignalPriceDeltaPct — signed one-decimal percent", () => {
  test("test_zero_rounds_to_unsigned_zero", () => {
    expect(formatSignalPriceDeltaPct(0)).toBe("0.0%");
  });

  test("test_negligible_drift_rounds_to_zero_no_sign", () => {
    expect(formatSignalPriceDeltaPct(0.04)).toBe("0.0%");
    expect(formatSignalPriceDeltaPct(-0.03)).toBe("0.0%");
  });

  test("test_positive_drift_carries_plus_sign", () => {
    expect(formatSignalPriceDeltaPct(1.1)).toBe("+1.1%");
    expect(formatSignalPriceDeltaPct(3.45)).toBe("+3.5%");
  });

  test("test_negative_drift_carries_minus_sign", () => {
    expect(formatSignalPriceDeltaPct(-2.3)).toBe("-2.3%");
    expect(formatSignalPriceDeltaPct(-0.6)).toBe("-0.6%");
  });

  test("test_BRK_B_user_example_renders_plus_1_point_1", () => {
    // Direct regression for the user's example: $503.60 → $509.20 is
    // a +1.11% drift, which should display as "+1.1%".
    const pct = ((509.2 - 503.6) / 503.6) * 100;
    expect(formatSignalPriceDeltaPct(pct)).toBe("+1.1%");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Section 3: computeSignalPriceDisplay — both-prices happy path
// ─────────────────────────────────────────────────────────────────────

describe("computeSignalPriceDisplay — both prices present", () => {
  test("test_BRK_B_user_example_renders_full_payload", () => {
    const out = computeSignalPriceDisplay(503.6, 509.2);
    expect(out).not.toBeNull();
    expect(out!.priceAtSignal).toBe(503.6);
    expect(out!.currentPrice).toBe(509.2);
    expect(out!.deltaPct).toBeCloseTo(1.112, 2);
    expect(out!.driftTier).toBe("moderate");
    expect(out!.accessibleLabel).toContain("$503.60");
    expect(out!.accessibleLabel).toContain("$509.20");
    expect(out!.accessibleLabel).toContain("Drift up 1.1 percent");
  });

  test("test_equal_prices_band_to_none", () => {
    const out = computeSignalPriceDisplay(500, 500);
    expect(out!.deltaPct).toBe(0);
    expect(out!.driftTier).toBe("none");
  });

  test("test_negative_drift_bands_correctly", () => {
    // 500 → 480 = -4% drift, sits in elevated tier.
    const out = computeSignalPriceDisplay(500, 480);
    expect(out!.deltaPct).toBe(-4);
    expect(out!.driftTier).toBe("elevated");
    expect(out!.accessibleLabel).toContain("Drift down 4.0 percent");
  });

  test("test_large_positive_drift_bands_to_stale", () => {
    // 100 → 108 = +8% drift, definitely stale geometry.
    const out = computeSignalPriceDisplay(100, 108);
    expect(out!.deltaPct).toBe(8);
    expect(out!.driftTier).toBe("stale");
  });

  test("test_marginal_drift_bands_correctly", () => {
    // 100 → 100.5 = +0.5% drift, marginal.
    const out = computeSignalPriceDisplay(100, 100.5);
    expect(out!.deltaPct).toBeCloseTo(0.5, 4);
    expect(out!.driftTier).toBe("marginal");
  });

  test("test_accessible_label_pronounces_unchanged_when_essentially_zero", () => {
    const out = computeSignalPriceDisplay(100, 100.03);
    expect(out!.accessibleLabel).toContain("unchanged");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Section 4: computeSignalPriceDisplay — degenerate price shapes
// ─────────────────────────────────────────────────────────────────────

describe("computeSignalPriceDisplay — defensive input handling", () => {
  test("test_both_null_returns_null_no_row", () => {
    expect(computeSignalPriceDisplay(null, null)).toBeNull();
    expect(computeSignalPriceDisplay(undefined, undefined)).toBeNull();
  });

  test("test_only_priceAtSignal_present_renders_partial_row", () => {
    const out = computeSignalPriceDisplay(503.6, null);
    expect(out).not.toBeNull();
    expect(out!.priceAtSignal).toBe(503.6);
    expect(out!.currentPrice).toBeNull();
    expect(out!.deltaPct).toBeNull();
    expect(out!.driftTier).toBeNull();
    expect(out!.accessibleLabel).toContain("Current price unavailable");
  });

  test("test_only_currentPrice_present_renders_partial_row", () => {
    const out = computeSignalPriceDisplay(null, 509.2);
    expect(out).not.toBeNull();
    expect(out!.priceAtSignal).toBeNull();
    expect(out!.currentPrice).toBe(509.2);
    expect(out!.deltaPct).toBeNull();
    expect(out!.driftTier).toBeNull();
    expect(out!.accessibleLabel).toContain("Signal computed-at price unavailable");
  });

  test("test_zero_priceAtSignal_treated_as_missing", () => {
    // A zero price is never legitimate — typically means "snapshot
    // was unavailable at signal-emit time." Don't divide by zero.
    const out = computeSignalPriceDisplay(0, 509.2);
    expect(out!.priceAtSignal).toBeNull();
    expect(out!.deltaPct).toBeNull();
    expect(out!.driftTier).toBeNull();
  });

  test("test_negative_priceAtSignal_treated_as_missing", () => {
    const out = computeSignalPriceDisplay(-5, 509.2);
    expect(out!.priceAtSignal).toBeNull();
    expect(out!.deltaPct).toBeNull();
  });

  test("test_NaN_priceAtSignal_treated_as_missing", () => {
    const out = computeSignalPriceDisplay(Number.NaN, 509.2);
    expect(out!.priceAtSignal).toBeNull();
    expect(out!.deltaPct).toBeNull();
  });

  test("test_Infinity_priceAtSignal_treated_as_missing", () => {
    const out = computeSignalPriceDisplay(Number.POSITIVE_INFINITY, 509.2);
    expect(out!.priceAtSignal).toBeNull();
  });

  test("test_zero_currentPrice_treated_as_missing", () => {
    const out = computeSignalPriceDisplay(503.6, 0);
    expect(out!.priceAtSignal).toBe(503.6);
    expect(out!.currentPrice).toBeNull();
    expect(out!.deltaPct).toBeNull();
  });

  test("test_both_invalid_returns_null", () => {
    // Helper treats every non-positive / non-finite shape as missing,
    // so two "invalid" inputs collapse to the both-null case.
    expect(computeSignalPriceDisplay(0, Number.NaN)).toBeNull();
    expect(computeSignalPriceDisplay(-1, -1)).toBeNull();
    expect(computeSignalPriceDisplay(Number.NaN, Number.NaN)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Section 5: copy hygiene — no advice-language in helper output
// ─────────────────────────────────────────────────────────────────────

describe("computeSignalPriceDisplay — accessible label hygiene", () => {
  test("test_accessibleLabel_never_recommends_action", () => {
    // The drift row surfaces data only. The label MUST NOT recommend
    // the user wait, plan, avoid, or otherwise act on the drift.
    // Lock-in across a range of drift magnitudes including the stale
    // tier where the temptation to add "consider waiting" copy is
    // strongest.
    const samples = [
      computeSignalPriceDisplay(100, 100),
      computeSignalPriceDisplay(100, 100.5),
      computeSignalPriceDisplay(100, 102),
      computeSignalPriceDisplay(100, 104),
      computeSignalPriceDisplay(100, 110),
      computeSignalPriceDisplay(100, 92)
    ];
    const forbidden = [
      "recommend",
      "we suggest",
      "you should",
      "consider waiting",
      "avoid",
      "do not",
      "don't",
      "approved",
      "stale signal"
    ];
    for (const sample of samples) {
      const lower = sample!.accessibleLabel.toLowerCase();
      for (const phrase of forbidden) {
        expect(lower).not.toContain(phrase);
      }
    }
  });
});
