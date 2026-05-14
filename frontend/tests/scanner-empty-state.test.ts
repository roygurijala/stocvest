import { describe, expect, test } from "vitest";

import {
  buildDayEmptyStateContext,
  buildGapIntelEmptyStateContext,
  buildSwingEmptyStateContext,
  DAY_VOCABULARY_BAN_FOR_SWING,
  effectiveScannerUniverseDisplayCount,
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

describe("effectiveScannerUniverseDisplayCount", () => {
  test("prefers gap intelligence snapshot count when present", () => {
    expect(
      effectiveScannerUniverseDisplayCount({
        swingUniverseSymbolCount: 6,
        gapIntelligenceSnapshotSymbolCount: 8_432
      })
    ).toBe(8_432);
  });

  test("falls back to swing universe count", () => {
    expect(effectiveScannerUniverseDisplayCount({ swingUniverseSymbolCount: 6 })).toBe(6);
  });
});

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

describe("buildGapIntelEmptyStateContext — distinct from setups copy (load-bearing)", () => {
  // The user reported a real UX bug: on a quiet load, the Gap
  // Intelligence column and the Swing setups column were showing
  // *identical text* because both were wired to
  // `buildSwingEmptyStateContext`. Gap Intelligence is a different
  // surface (gated on magnitude + volume backing, not regime + per
  // -symbol score), so it needs its own copy. These tests pin that
  // contract so a future refactor can't quietly re-collapse the two.

  test("test_gap_swing_variant_returns_gap_surface_discriminator", () => {
    const ctx = buildGapIntelEmptyStateContext(baseInput, "swing");
    expect(ctx.surface).toBe("gap");
    expect(ctx.mode).toBe("swing");
    expect(ctx.reenableBullets.length).toBeGreaterThanOrEqual(3);
  });

  test("test_gap_day_variant_carries_session_flag", () => {
    const ctx = buildGapIntelEmptyStateContext(baseInput, "day");
    expect(ctx.surface).toBe("gap");
    expect(ctx.mode).toBe("day");
    expect(ctx.sessionOpen).toBe(true);
  });

  test("test_gap_headline_is_NOT_same_as_swing_setups_headline", () => {
    // The literal bug the user spotted: same text in both columns.
    const gap = buildGapIntelEmptyStateContext(baseInput, "swing");
    const swing = buildSwingEmptyStateContext(baseInput);
    expect(gap.headline).not.toBe(swing.headline);
    expect(gap.oneLiner).not.toBe(swing.oneLiner);
    // Bullets shouldn't be byte-identical either.
    expect(gap.reenableBullets.join("|")).not.toBe(swing.reenableBullets.join("|"));
  });

  test("test_gap_headline_is_NOT_same_as_day_setups_headline", () => {
    const gap = buildGapIntelEmptyStateContext(baseInput, "day");
    const day = buildDayEmptyStateContext(baseInput);
    expect(gap.headline).not.toBe(day.headline);
    expect(gap.oneLiner).not.toBe(day.oneLiner);
    expect(gap.reenableBullets.join("|")).not.toBe(day.reenableBullets.join("|"));
  });

  test("test_gap_copy_names_the_two_universal_gap_gates", () => {
    // Magnitude (gap size) + volume confirmation are THE gap gates.
    // If the copy stops mentioning either, the empty state has
    // stopped explaining what gap intelligence actually filters on.
    const swing = buildGapIntelEmptyStateContext(baseInput, "swing");
    const day = buildGapIntelEmptyStateContext(baseInput, "day");
    const combinedSwing = `${swing.headline} ${swing.oneLiner} ${swing.reenableBullets.join(" ")}`.toLowerCase();
    const combinedDay = `${day.headline} ${day.oneLiner} ${day.reenableBullets.join(" ")}`.toLowerCase();
    for (const text of [combinedSwing, combinedDay]) {
      expect(text).toMatch(/gap/);
      expect(text).toMatch(/volume/);
    }
  });

  test("test_gap_swing_variant_never_uses_day_vocabulary", () => {
    // Vocab discipline: when the user is on the Swing tab, the gap
    // card hue + copy should be swing-aligned. Day-side micro-
    // structure terms ("VWAP", "ORB", "RVOL") would be confusing
    // here since the swing engine doesn't reason about them.
    const ctx = buildGapIntelEmptyStateContext(baseInput, "swing");
    const text = `${ctx.headline} ${ctx.oneLiner} ${ctx.reenableBullets.join(" ")}`.toLowerCase();
    for (const banned of DAY_VOCABULARY_BAN_FOR_SWING) {
      expect(text).not.toContain(banned.toLowerCase());
    }
  });

  test("test_gap_day_variant_never_uses_swing_vocabulary", () => {
    const ctx = buildGapIntelEmptyStateContext(baseInput, "day");
    const text = `${ctx.headline} ${ctx.oneLiner} ${ctx.reenableBullets.join(" ")}`.toLowerCase();
    for (const banned of SWING_VOCABULARY_BAN_FOR_DAY) {
      expect(text).not.toContain(banned.toLowerCase());
    }
  });

  test("test_gap_copy_never_uses_recommendation_words", () => {
    const gapSwing = buildGapIntelEmptyStateContext(baseInput, "swing");
    const gapDay = buildGapIntelEmptyStateContext(baseInput, "day");
    const combined = `${gapSwing.headline} ${gapSwing.oneLiner} ${gapSwing.reenableBullets.join(" ")} ${gapDay.headline} ${gapDay.oneLiner} ${gapDay.reenableBullets.join(" ")}`.toLowerCase();
    for (const banned of ["recommend", "approve", "validated", "qualified to trade", "cleared to trade", "endorsed"]) {
      expect(combined).not.toContain(banned);
    }
  });

  test("test_gap_day_variant_when_session_closed_softens_the_volume_bullet", () => {
    const ctx = buildGapIntelEmptyStateContext(
      { ...baseInput, marketStatus: { market: "closed" } },
      "day"
    );
    expect(ctx.sessionOpen).toBe(false);
    // Outside regular session we should not be asserting opening-
    // session RVOL — the gap is observed against premarket build.
    const bullets = ctx.reenableBullets.join(" ").toLowerCase();
    expect(bullets).toMatch(/premarket|next regular session|next open/);
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
