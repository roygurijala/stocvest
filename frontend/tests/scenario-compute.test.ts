import { describe, expect, test } from "vitest";

import {
  computeScenarioResult,
  formatRMultiple,
  formatScenarioDollars,
  formatScenarioForClipboard,
  formatScenarioPercent
} from "@/lib/scenario/compute";

describe("computeScenarioResult", () => {
  test("test_long_scenario_2R", () => {
    // Entry 100, stop 95 (risk = 5), target 110 (reward = 10) => 2R.
    const result = computeScenarioResult({
      entry: 100,
      stop: 95,
      target: 110,
      shares: 50
    });
    expect(result.risk_per_share).toBe(5);
    expect(result.total_risk_dollars).toBe(250);
    expect(result.r_multiple_to_target).toBe(2);
    expect(result.cost_basis_dollars).toBe(5000);
    expect(result.risk_pct_of_account).toBeNull();
  });

  test("test_short_scenario_2R_uses_abs_distances", () => {
    // Entry 100, stop 105 (risk = 5), target 90 (reward = 10) => 2R.
    const result = computeScenarioResult({
      entry: 100,
      stop: 105,
      target: 90,
      shares: 20
    });
    expect(result.risk_per_share).toBe(5);
    expect(result.total_risk_dollars).toBe(100);
    expect(result.r_multiple_to_target).toBe(2);
    expect(result.cost_basis_dollars).toBe(2000);
  });

  test("test_zero_risk_returns_NaN_r_multiple", () => {
    const result = computeScenarioResult({
      entry: 100,
      stop: 100,
      target: 110,
      shares: 10
    });
    expect(Number.isNaN(result.r_multiple_to_target)).toBe(true);
  });

  test("test_zero_shares_zero_risk_dollars_zero_cost_basis", () => {
    const result = computeScenarioResult({
      entry: 100,
      stop: 95,
      target: 110,
      shares: 0
    });
    expect(result.risk_per_share).toBe(5);
    // Defensive: shares must be positive to produce risk_dollars. Zero
    // shares is structurally invalid (the modal's input has min=0 but
    // we still treat 0 as "user hasn't sized yet" and emit NaN).
    expect(Number.isNaN(result.total_risk_dollars)).toBe(true);
    expect(Number.isNaN(result.cost_basis_dollars)).toBe(true);
  });

  test("test_nan_inputs_propagate_to_nan_outputs", () => {
    const result = computeScenarioResult({
      entry: Number.NaN,
      stop: 95,
      target: 110,
      shares: 10
    });
    expect(Number.isNaN(result.risk_per_share)).toBe(true);
    expect(Number.isNaN(result.r_multiple_to_target)).toBe(true);
    expect(Number.isNaN(result.cost_basis_dollars)).toBe(true);
  });

  test("test_account_size_provided_computes_percent", () => {
    const result = computeScenarioResult({
      entry: 100,
      stop: 95,
      target: 110,
      shares: 50,
      account_size: 25000
    });
    // total_risk = 250, account = 25000 → 1.0%.
    expect(result.risk_pct_of_account).toBeCloseTo(1.0, 6);
  });

  test("test_account_size_zero_or_negative_returns_null", () => {
    const a = computeScenarioResult({
      entry: 100,
      stop: 95,
      target: 110,
      shares: 50,
      account_size: 0
    });
    const b = computeScenarioResult({
      entry: 100,
      stop: 95,
      target: 110,
      shares: 50,
      account_size: -100
    });
    expect(a.risk_pct_of_account).toBeNull();
    expect(b.risk_pct_of_account).toBeNull();
  });
});

describe("formatters", () => {
  test("test_formatScenarioDollars_thousands_grouping", () => {
    expect(formatScenarioDollars(1234.5)).toBe("$1,234.50");
    expect(formatScenarioDollars(1234567.89)).toBe("$1,234,567.89");
    expect(formatScenarioDollars(-250.4)).toBe("-$250.40");
  });

  test("test_formatScenarioDollars_NaN_renders_em_dash", () => {
    expect(formatScenarioDollars(Number.NaN)).toBe("—");
    expect(formatScenarioDollars(Number.POSITIVE_INFINITY)).toBe("—");
  });

  test("test_formatRMultiple", () => {
    expect(formatRMultiple(2)).toBe("2.00R");
    expect(formatRMultiple(1.534)).toBe("1.53R");
    expect(formatRMultiple(Number.NaN)).toBe("—");
  });

  test("test_formatScenarioPercent", () => {
    expect(formatScenarioPercent(1.234)).toBe("1.23%");
    expect(formatScenarioPercent(null)).toBe("—");
    expect(formatScenarioPercent(Number.NaN)).toBe("—");
  });
});

describe("formatScenarioForClipboard", () => {
  test("test_clipboard_text_includes_disclaimer", () => {
    const text = formatScenarioForClipboard(
      "AAPL",
      "bullish",
      "swing",
      {
        entry: 100,
        stop: 95,
        target: 110,
        shares: 50,
        account_size: 25000,
        order_type_label: "limit"
      },
      computeScenarioResult({
        entry: 100,
        stop: 95,
        target: 110,
        shares: 50,
        account_size: 25000
      })
    );
    // Disclaimer must be present in every clipboard payload — this is
    // the legal-safety boilerplate the user pastes into their broker.
    expect(text).toContain("planning scenario");
    expect(text).toContain("STOCVEST does not submit");
  });

  test("test_clipboard_text_includes_planning_and_computed_sections", () => {
    const text = formatScenarioForClipboard(
      "AAPL",
      "bullish",
      "swing",
      {
        entry: 100,
        stop: 95,
        target: 110,
        shares: 50
      },
      computeScenarioResult({
        entry: 100,
        stop: 95,
        target: 110,
        shares: 50
      })
    );
    expect(text).toContain("Planning inputs:");
    expect(text).toContain("Computed:");
    expect(text).toContain("R-multiple to target: 2.00R");
  });

  test("test_clipboard_text_never_uses_recommendation_words", () => {
    const text = formatScenarioForClipboard(
      "AAPL",
      "bearish",
      "day",
      {
        entry: 100,
        stop: 105,
        target: 90,
        shares: 30
      },
      computeScenarioResult({
        entry: 100,
        stop: 105,
        target: 90,
        shares: 30
      })
    ).toLowerCase();
    for (const banned of ["recommend", "approve", "validated", "qualified", "cleared", "endorsed"]) {
      expect(text).not.toContain(banned);
    }
  });
});
