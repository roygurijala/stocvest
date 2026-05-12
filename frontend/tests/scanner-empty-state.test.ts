import { describe, expect, test } from "vitest";

import {
  buildDayEmptyStateContext,
  buildSwingEmptyStateContext,
  DAY_VOCABULARY_BAN_FOR_SWING,
  formatTapeReadout,
  SWING_VOCABULARY_BAN_FOR_DAY
} from "@/lib/scanner-empty-state";

const baseInput = {
  regimeLabel: "Neutral",
  spyPct: 0.32,
  qqqPct: -0.18,
  swingUniverseSymbolCount: 240,
  sectorPct5d: [0.4, -0.1, 0.2],
  marketStatus: { market: "open" } as { market: string }
};

describe("buildSwingEmptyStateContext — structural shape", () => {
  test("test_returns_swing_discriminated_mode_and_universe_size", () => {
    const ctx = buildSwingEmptyStateContext(baseInput);
    expect(ctx.mode).toBe("swing");
    expect(ctx.universeSize).toBe(240);
    expect(ctx.regimeLabel).toBe("Neutral");
    expect(ctx.spyPct).toBe(0.32);
    expect(ctx.qqqPct).toBe(-0.18);
    expect(ctx.reenableBullets.length).toBeGreaterThanOrEqual(3);
  });

  test("test_universe_size_is_null_when_overview_omitted_it", () => {
    const ctx = buildSwingEmptyStateContext({
      regimeLabel: "Bullish",
      spyPct: null,
      qqqPct: null
    });
    expect(ctx.universeSize).toBeNull();
    expect(ctx.spyPct).toBeNull();
    expect(ctx.qqqPct).toBeNull();
  });

  test("test_bearish_regime_swing_headline_names_bearish_gate", () => {
    const ctx = buildSwingEmptyStateContext({ ...baseInput, regimeLabel: "Bearish" });
    expect(ctx.headline.toLowerCase()).toContain("bearish");
  });

  test("test_bullish_regime_swing_headline_acknowledges_constructive", () => {
    const ctx = buildSwingEmptyStateContext({ ...baseInput, regimeLabel: "Bullish" });
    expect(ctx.headline.toLowerCase()).toContain("constructive");
  });
});

describe("buildDayEmptyStateContext — structural shape", () => {
  test("test_returns_day_discriminated_mode_with_session_flag", () => {
    const ctx = buildDayEmptyStateContext(baseInput);
    expect(ctx.mode).toBe("day");
    expect(ctx.sessionOpen).toBe(true);
    expect(ctx.reenableBullets.length).toBeGreaterThanOrEqual(3);
  });

  test("test_session_closed_when_market_status_closed", () => {
    const ctx = buildDayEmptyStateContext({
      ...baseInput,
      marketStatus: { market: "closed" }
    });
    expect(ctx.sessionOpen).toBe(false);
    expect(ctx.headline.toLowerCase()).toContain("suppressed");
  });

  test("test_extended_hours_is_NOT_treated_as_open", () => {
    const ctx = buildDayEmptyStateContext({
      ...baseInput,
      marketStatus: { market: "extended-hours" }
    });
    // Extended-hours prints don't qualify for intraday gates per the
    // dashboard re-enable copy. The Scanner empty state mirrors that.
    expect(ctx.sessionOpen).toBe(false);
  });
});

describe("empty-state mode separation — vocabulary anti-leak (load-bearing)", () => {
  // These are the Mode Separation rules from ASSISTANT_SYSTEM_PROMPT
  // expressed as a UI-layer lock-in: swing-side copy never leaks
  // day-vocabulary tokens and vice versa. A future copy edit that
  // accidentally pastes day-side wording into the swing surface (e.g.
  // "Swing setups need intraday confirmation …") trips this.

  test("test_swing_context_never_uses_day_vocabulary_in_headline_or_oneliner", () => {
    const ctx = buildSwingEmptyStateContext(baseInput);
    const text = `${ctx.headline} ${ctx.oneLiner}`.toLowerCase();
    for (const banned of DAY_VOCABULARY_BAN_FOR_SWING) {
      expect(text).not.toContain(banned.toLowerCase());
    }
  });

  test("test_day_context_never_uses_swing_vocabulary_in_headline_or_oneliner", () => {
    const ctx = buildDayEmptyStateContext(baseInput);
    const text = `${ctx.headline} ${ctx.oneLiner}`.toLowerCase();
    for (const banned of SWING_VOCABULARY_BAN_FOR_DAY) {
      expect(text).not.toContain(banned.toLowerCase());
    }
  });

  test("test_swing_reenable_bullets_never_use_day_vocabulary", () => {
    // The dashboard's `buildSwingReenableBullets` is the source of
    // truth for these — they were already audited there. This is a
    // belt-and-suspenders assertion at the Scanner layer.
    const ctx = buildSwingEmptyStateContext(baseInput);
    const text = ctx.reenableBullets.join(" ").toLowerCase();
    for (const banned of DAY_VOCABULARY_BAN_FOR_SWING) {
      expect(text).not.toContain(banned.toLowerCase());
    }
  });

  test("test_day_reenable_bullets_never_use_swing_vocabulary", () => {
    const ctx = buildDayEmptyStateContext({ ...baseInput, regimeLabel: "Neutral" });
    const text = ctx.reenableBullets.join(" ").toLowerCase();
    for (const banned of SWING_VOCABULARY_BAN_FOR_DAY) {
      expect(text).not.toContain(banned.toLowerCase());
    }
  });

  test("test_no_context_uses_recommendation_words", () => {
    const swing = buildSwingEmptyStateContext(baseInput);
    const day = buildDayEmptyStateContext(baseInput);
    const combined = `${swing.headline} ${swing.oneLiner} ${swing.reenableBullets.join(" ")} ${day.headline} ${day.oneLiner} ${day.reenableBullets.join(" ")}`.toLowerCase();
    for (const banned of ["recommend", "approve", "validated", "qualified to trade", "cleared to trade", "endorsed"]) {
      expect(combined).not.toContain(banned);
    }
  });
});

describe("formatTapeReadout", () => {
  test("test_renders_both_legs_with_signed_percent", () => {
    expect(formatTapeReadout(0.32, -0.18)).toBe("SPY +0.32% · QQQ -0.18%");
  });

  test("test_empty_string_when_both_legs_null", () => {
    expect(formatTapeReadout(null, null)).toBe("");
  });

  test("test_one_leg_present_one_leg_null", () => {
    expect(formatTapeReadout(0.5, null)).toBe("SPY +0.50% · QQQ —");
    expect(formatTapeReadout(null, 0.5)).toBe("SPY — · QQQ +0.50%");
  });

  test("test_non_finite_inputs_collapse_to_em_dash", () => {
    expect(formatTapeReadout(Number.NaN, Number.POSITIVE_INFINITY)).toBe("SPY — · QQQ —");
  });
});
