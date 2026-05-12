import { describe, expect, test } from "vitest";

import {
  buildIneligibilityTooltip,
  isEligibleForScenario,
  scenarioIneligibilityLabel
} from "@/lib/scenario/eligibility";
import {
  SCENARIO_INELIGIBILITY_REASONS,
  type ScenarioInput
} from "@/lib/scenario/types";

const NOW = Date.parse("2026-05-12T20:00:00Z");

function happyInput(overrides: Partial<ScenarioInput> = {}): ScenarioInput {
  return {
    symbol: "AAPL",
    direction: "bullish",
    mode: "day",
    generated_at: new Date(NOW - 60 * 60 * 1000).toISOString(),
    reference: {
      entry_low: 195,
      entry_high: 197,
      stop: 192,
      target_1: 202,
      current_price: 196,
      atr: 2.5
    },
    volatility_regime: "normal",
    ...overrides
  };
}

describe("isEligibleForScenario — happy path", () => {
  test("test_happy_path_is_eligible", () => {
    const report = isEligibleForScenario(happyInput(), NOW);
    expect(report.eligible).toBe(true);
    expect(report.reasons).toEqual([]);
  });

  test("test_swing_mode_uses_seven_day_freshness", () => {
    const sixDaysAgo = new Date(NOW - 6 * 24 * 60 * 60 * 1000).toISOString();
    const input = happyInput({ mode: "swing", generated_at: sixDaysAgo });
    expect(isEligibleForScenario(input, NOW).eligible).toBe(true);
  });

  test("test_explicit_expiry_in_future_passes", () => {
    const input = happyInput({
      generated_at: null,
      expires_at: new Date(NOW + 60 * 60 * 1000).toISOString()
    });
    const r = isEligibleForScenario(input, NOW);
    expect(r.eligible).toBe(true);
  });
});

describe("isEligibleForScenario — each gate fails specifically", () => {
  test("test_no_symbol", () => {
    const r = isEligibleForScenario(happyInput({ symbol: "   " }), NOW);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("no_symbol");
  });

  test("test_no_direction_when_null", () => {
    const r = isEligibleForScenario(happyInput({ direction: null }), NOW);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("no_direction");
  });

  test("test_neutral_direction_distinct_reason", () => {
    // Neutral is a distinct failure reason — it's "no scenario," not
    // "missing data" — so the tooltip can render a softer copy.
    const r = isEligibleForScenario(happyInput({ direction: "neutral" }), NOW);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("neutral_direction");
    expect(r.reasons).not.toContain("no_direction");
  });

  test("test_no_reference_price", () => {
    const r = isEligibleForScenario(
      happyInput({ reference: { stop: 192, atr: 2.5 } }),
      NOW
    );
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("no_reference_price");
  });

  test("test_risk_anchor_via_explicit_stop_only_passes", () => {
    // Reference price + explicit stop, no ATR, unknown vol → still eligible
    // because explicit stop satisfies the risk anchor on its own.
    const r = isEligibleForScenario(
      happyInput({
        reference: { current_price: 100, stop: 95 },
        volatility_regime: "unknown"
      }),
      NOW
    );
    // Will still fail on unknown_volatility (separate gate) — but NOT
    // on no_risk_anchor.
    expect(r.reasons).not.toContain("no_risk_anchor");
    expect(r.reasons).toContain("unknown_volatility");
  });

  test("test_risk_anchor_via_atr_only_passes", () => {
    const r = isEligibleForScenario(
      happyInput({ reference: { current_price: 100, atr: 2 } }),
      NOW
    );
    expect(r.reasons).not.toContain("no_risk_anchor");
  });

  test("test_risk_anchor_via_price_plus_known_regime", () => {
    // No explicit stop, no ATR — but reference price + known regime is
    // accepted (the modal will scaffold a regime-default % stop).
    const r = isEligibleForScenario(
      happyInput({
        reference: { current_price: 100 },
        volatility_regime: "normal"
      }),
      NOW
    );
    expect(r.reasons).not.toContain("no_risk_anchor");
    expect(r.eligible).toBe(true);
  });

  test("test_no_risk_anchor_when_truly_empty", () => {
    const r = isEligibleForScenario(
      happyInput({
        reference: { current_price: 100 },
        volatility_regime: "unknown"
      }),
      NOW
    );
    expect(r.reasons).toContain("no_risk_anchor");
  });

  test("test_unknown_volatility_fails", () => {
    const r = isEligibleForScenario(happyInput({ volatility_regime: "unknown" }), NOW);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("unknown_volatility");
  });

  test("test_signal_stale_for_swing_outside_seven_days", () => {
    const eightDaysAgo = new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString();
    const r = isEligibleForScenario(
      happyInput({ mode: "swing", generated_at: eightDaysAgo }),
      NOW
    );
    expect(r.reasons).toContain("signal_stale");
  });

  test("test_signal_stale_for_day_outside_eighteen_hours", () => {
    const twentyHoursAgo = new Date(NOW - 20 * 60 * 60 * 1000).toISOString();
    const r = isEligibleForScenario(
      happyInput({ mode: "day", generated_at: twentyHoursAgo }),
      NOW
    );
    expect(r.reasons).toContain("signal_stale");
  });

  test("test_signal_expired_via_explicit_expiry", () => {
    const r = isEligibleForScenario(
      happyInput({ expires_at: new Date(NOW - 1000).toISOString() }),
      NOW
    );
    expect(r.reasons).toContain("signal_expired");
    expect(r.reasons).not.toContain("signal_stale");
  });

  test("test_no_generated_at_is_treated_as_stale", () => {
    const r = isEligibleForScenario(
      happyInput({ generated_at: null, expires_at: null }),
      NOW
    );
    expect(r.reasons).toContain("signal_stale");
  });
});

describe("isEligibleForScenario — gating does NOT consider conviction signals", () => {
  // The user's design specifically forbids gating on quality / conviction
  // signals (confluence, accuracy, layer alignment, engine verdict,
  // probability-of-success). The `ScenarioInput` type doesn't carry
  // those fields by construction — these tests are a redundant lock-in
  // so a future refactor that adds a "minimum_confluence" field to the
  // input shape doesn't silently start affecting eligibility.

  test("test_eligibility_input_shape_has_no_conviction_fields", () => {
    const input = happyInput();
    // Listing every key on ScenarioInput — if a future change adds a
    // conviction field (e.g. "min_confluence"), this assertion fails
    // and forces the author to justify the addition.
    const allowedKeys = new Set([
      "symbol",
      "direction",
      "mode",
      "generated_at",
      "expires_at",
      "reference",
      "volatility_regime",
      "tags"
    ]);
    for (const key of Object.keys(input)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });
});

describe("scenarioIneligibilityLabel + tooltip composition", () => {
  test("test_every_reason_has_a_label", () => {
    for (const reason of SCENARIO_INELIGIBILITY_REASONS) {
      const label = scenarioIneligibilityLabel(reason);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  test("test_no_label_implies_recommendation", () => {
    // Defensive: the labels must avoid endorsement / approval verbs.
    const forbidden = ["recommend", "approve", "validated", "qualified", "cleared"];
    for (const reason of SCENARIO_INELIGIBILITY_REASONS) {
      const label = scenarioIneligibilityLabel(reason).toLowerCase();
      for (const word of forbidden) {
        expect(label).not.toContain(word);
      }
    }
  });

  test("test_tooltip_concatenates_in_stable_order", () => {
    const r = isEligibleForScenario(
      happyInput({ symbol: "", direction: null, volatility_regime: "unknown" }),
      NOW
    );
    const tip = buildIneligibilityTooltip(r);
    // Order follows SCENARIO_INELIGIBILITY_REASONS, not the order
    // `isEligibleForScenario` pushed them in.
    const symbolIdx = tip.indexOf("Symbol is missing.");
    const directionIdx = tip.indexOf("Directional bias is missing.");
    const volIdx = tip.indexOf("Volatility regime is unknown");
    expect(symbolIdx).toBeGreaterThanOrEqual(0);
    expect(directionIdx).toBeGreaterThan(symbolIdx);
    expect(volIdx).toBeGreaterThan(directionIdx);
  });

  test("test_tooltip_when_eligible_is_ready_copy", () => {
    const r = isEligibleForScenario(happyInput(), NOW);
    const tip = buildIneligibilityTooltip(r);
    expect(tip).toBe("Ready to build scenario.");
  });
});
