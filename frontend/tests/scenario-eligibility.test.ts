import { describe, expect, test } from "vitest";

import {
  buildIneligibilityTooltip,
  canOpenFullScenarioSheet,
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

describe("canOpenFullScenarioSheet", () => {
  test("opens when stop target direction and price exist", () => {
    expect(canOpenFullScenarioSheet(happyInput())).toBe(true);
  });

  test("opens when stale or low rr even if isEligibleForScenario fails", () => {
    const stale = happyInput({
      mode: "swing",
      generated_at: new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString(),
      risk_reward: 1.2
    });
    expect(isEligibleForScenario(stale, NOW).eligible).toBe(false);
    expect(canOpenFullScenarioSheet(stale)).toBe(true);
  });

  test("preview when stop missing", () => {
    expect(
      canOpenFullScenarioSheet(
        happyInput({ reference: { ...happyInput().reference, stop: null } })
      )
    ).toBe(false);
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

  test("test_no_stop_when_missing", () => {
    const r = isEligibleForScenario(
      happyInput({ reference: { current_price: 100, target_1: 110, atr: 2.5 } }),
      NOW
    );
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("no_stop");
  });

  test("test_no_target_when_missing", () => {
    const r = isEligibleForScenario(
      happyInput({ reference: { current_price: 100, stop: 95, atr: 2.5 } }),
      NOW
    );
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("no_target");
  });

  test("test_risk_anchor_via_explicit_stop_and_target_passes", () => {
    const r = isEligibleForScenario(
      happyInput({
        reference: { current_price: 100, stop: 95, target_1: 110 },
        volatility_regime: "unknown"
      }),
      NOW
    );
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

  test("test_risk_anchor_via_price_plus_known_regime_requires_stop_and_target", () => {
    const r = isEligibleForScenario(
      happyInput({
        reference: { current_price: 100 },
        volatility_regime: "normal"
      }),
      NOW
    );
    expect(r.reasons).toContain("no_stop");
    expect(r.reasons).toContain("no_target");
    expect(r.eligible).toBe(false);
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
    //
    // `risk_reward` is allowed (added 2026-05-13, BRK.B feedback): it is
    // pure entry/stop/target arithmetic on the reference levels the
    // signal already carries, NOT a quality verdict. The eligibility
    // helper uses it to reject scenarios whose reference levels are
    // mechanically degenerate for structured planning (R/R < 2.0).
    const allowedKeys = new Set([
      "symbol",
      "direction",
      "mode",
      "generated_at",
      "expires_at",
      "reference",
      "volatility_regime",
      "risk_reward",
      "tags"
    ]);
    for (const key of Object.keys(input)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });
});

describe("isEligibleForScenario — low risk/reward gate (BRK.B feedback, 2026-05-13)", () => {
  // The user reported on 2026-05-13 that the Build Scenario button on
  // the BRK.B evidence card was enabled even though the Decision line
  // said "Monitor only" and the risk/reward read 0.5:1. That is the
  // exact UX they wanted to avoid — the button should be in lock-step
  // with the structural threshold synthTradeDecision already uses.
  //
  // R/R < 2.0 is treated as a STRUCTURAL failure (the reference levels
  // do not form a coherent planning sheet), not as a conviction signal,
  // so the gate is consistent with the eligibility helper's "structural
  // completeness only" philosophy. The threshold matches
  // synthTradeDecision::rrFail.

  test("test_rr_below_2_still_eligible_for_planning_sheet", () => {
    const r = isEligibleForScenario(happyInput({ risk_reward: 0.5 }), NOW);
    expect(r.eligible).toBe(true);
    expect(r.reasons).not.toContain("low_risk_reward");
  });

  test("test_rr_below_2_brk_b_opens_builder_with_verdict_banner", () => {
    const r = isEligibleForScenario(
      happyInput({ symbol: "BRK.B", direction: "bullish", risk_reward: 0.5 }),
      NOW
    );
    expect(r.eligible).toBe(true);
    expect(r.reasons).not.toContain("low_risk_reward");
  });

  test("test_rr_at_threshold_2p0_is_eligible", () => {
    const r = isEligibleForScenario(happyInput({ risk_reward: 2.0 }), NOW);
    expect(r.reasons).not.toContain("low_risk_reward");
    expect(r.eligible).toBe(true);
  });

  test("test_rr_above_threshold_3p0_is_eligible", () => {
    const r = isEligibleForScenario(happyInput({ risk_reward: 3.0 }), NOW);
    expect(r.reasons).not.toContain("low_risk_reward");
    expect(r.eligible).toBe(true);
  });

  test("test_swing_rr_below_threshold_1p8_still_eligible", () => {
    const r = isEligibleForScenario(happyInput({ mode: "swing", risk_reward: 1.8 }), NOW);
    expect(r.eligible).toBe(true);
    expect(r.reasons).not.toContain("low_risk_reward");
  });

  test("test_day_rr_1p8_passes_above_desk_minimum", () => {
    const r = isEligibleForScenario(happyInput({ mode: "day", risk_reward: 1.8 }), NOW);
    expect(r.reasons).not.toContain("low_risk_reward");
    expect(r.eligible).toBe(true);
  });

  test("test_day_mode_rr_1p4_passes_swing_same_rr_still_eligible", () => {
    const day = isEligibleForScenario(happyInput({ mode: "day", risk_reward: 1.4 }), NOW);
    expect(day.eligible).toBe(true);

    const swing = isEligibleForScenario(happyInput({ mode: "swing", risk_reward: 1.4 }), NOW);
    expect(swing.eligible).toBe(true);
  });

  test("test_day_mode_rr_1p2_still_eligible", () => {
    const r = isEligibleForScenario(happyInput({ mode: "day", risk_reward: 1.2 }), NOW);
    expect(r.eligible).toBe(true);
  });

  test("test_rr_missing_field_does_not_gate", () => {
    // Legacy / partial-data path: when risk_reward is not provided, the
    // gate does NOT fire (we never gate on a property we cannot read).
    const r = isEligibleForScenario(happyInput({}), NOW);
    expect(r.reasons).not.toContain("low_risk_reward");
  });

  test("test_rr_null_does_not_gate", () => {
    const r = isEligibleForScenario(happyInput({ risk_reward: null }), NOW);
    expect(r.reasons).not.toContain("low_risk_reward");
  });

  test("test_rr_non_finite_does_not_gate", () => {
    const r = isEligibleForScenario(happyInput({ risk_reward: Number.NaN }), NOW);
    expect(r.reasons).not.toContain("low_risk_reward");
  });

  test("test_rr_zero_or_negative_does_not_gate", () => {
    // Zero / negative R/R is treated as "unknown" rather than "low" — it
    // typically indicates the signal payload didn't carry valid stop
    // and target levels, which is a different problem (no_risk_anchor)
    // not a gateable low-R/R structural failure.
    expect(isEligibleForScenario(happyInput({ risk_reward: 0 }), NOW).reasons).not.toContain(
      "low_risk_reward"
    );
    expect(isEligibleForScenario(happyInput({ risk_reward: -1 }), NOW).reasons).not.toContain(
      "low_risk_reward"
    );
  });

  test("test_low_rr_label_uses_internal_thresholds_framing", () => {
    // Copy invariant: the label must NOT say "we do not recommend this
    // trade" or "STOCVEST will not approve this trade." It MUST frame
    // the gate as an internal threshold on structured scenario building.
    const label = scenarioIneligibilityLabel("low_risk_reward");
    expect(label.toLowerCase()).toContain("scenario planning");
    // Anti-regression: phrases that imply endorsement.
    expect(label.toLowerCase()).not.toContain("we do not recommend");
    expect(label.toLowerCase()).not.toContain("trade permission");
    expect(label.toLowerCase()).not.toContain("approved");
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
