/**
 * Lock-in tests for `rankConflictingSignals` + `conflictTierLabel`
 * (BRK.B feedback, 2026-05-13).
 *
 * The user reported that the conflicting-signal rail on the evidence
 * card surfaced chips in arrival order with no way to tell which one
 * mattered most ("EMA conflict, VWAP conflict, Weak volume" — but the
 * user needed to know **which one is load-bearing**).
 *
 * The fix sorts conflicting chips by source priority (see
 * `CONFLICT_PRIORITY_BY_SOURCE` in `lib/signal-evidence.ts`) and labels
 * the first three with PRIMARY / SECONDARY / TERTIARY when there are
 * 2+ conflicts. These tests pin both the priority order and the tier
 * label semantics.
 */

import { describe, expect, test } from "vitest";

import {
  CONFLICT_PRIORITY_BY_SOURCE,
  conflictTierLabel,
  rankConflictingSignals
} from "@/lib/signal-evidence";

describe("CONFLICT_PRIORITY_BY_SOURCE — canonical priority order", () => {
  test("test_vwap_is_primary", () => {
    // VWAP rejection is the load-bearing technical anchor for both
    // intraday and swing setups. It MUST be the lowest priority number
    // so `rankConflictingSignals` sorts it to the head.
    expect(CONFLICT_PRIORITY_BY_SOURCE.vwap_position).toBe(1);
  });

  test("test_volume_is_secondary", () => {
    expect(CONFLICT_PRIORITY_BY_SOURCE.volume_confirm).toBe(2);
  });

  test("test_ema_is_tertiary", () => {
    expect(CONFLICT_PRIORITY_BY_SOURCE.ema_9_position).toBe(3);
  });

  test("test_context_sources_rank_below_execution_sources", () => {
    // Context sources (internals, sector, regime, news) MUST rank below
    // execution/structural sources (vwap, volume, ema). This is the
    // user's explicit feedback: "Reduce emphasis: Geo + Sector unless
    // active. Increase emphasis: Technical + Risk."
    const technical = Math.max(
      CONFLICT_PRIORITY_BY_SOURCE.vwap_position,
      CONFLICT_PRIORITY_BY_SOURCE.volume_confirm,
      CONFLICT_PRIORITY_BY_SOURCE.ema_9_position
    );
    const context = Math.min(
      CONFLICT_PRIORITY_BY_SOURCE.internals_alignment,
      CONFLICT_PRIORITY_BY_SOURCE.sector_alignment,
      CONFLICT_PRIORITY_BY_SOURCE.market_regime,
      CONFLICT_PRIORITY_BY_SOURCE.news_catalyst
    );
    expect(technical).toBeLessThan(context);
  });

  test("test_entry_timing_sources_rank_at_or_near_the_tail", () => {
    // Gap / ORB are entry-timing signals — usually downstream of the
    // primary technical anchors.
    expect(CONFLICT_PRIORITY_BY_SOURCE.gap_confirm).toBeGreaterThanOrEqual(8);
    expect(CONFLICT_PRIORITY_BY_SOURCE.orb_breakout).toBeGreaterThanOrEqual(8);
  });
});

describe("rankConflictingSignals — sorts by source priority", () => {
  test("test_brk_b_ema_vwap_volume_re_orders_to_vwap_volume_ema", () => {
    // Exact BRK.B scenario from the screenshot: chips arrive as
    // [EMA conflict, VWAP conflict, Weak volume] in arrival order. The
    // user expects to see them re-ordered to:
    //   PRIMARY:   VWAP rejection
    //   SECONDARY: Weak participation
    //   TERTIARY:  EMA misalignment
    const arrival = [
      { label: "EMA conflict", source: "ema_9_position" },
      { label: "VWAP conflict", source: "vwap_position" },
      { label: "Weak volume", source: "volume_confirm" }
    ];
    const ranked = rankConflictingSignals(arrival);
    expect(ranked.map((c) => c.source)).toEqual(["vwap_position", "volume_confirm", "ema_9_position"]);
  });

  test("test_full_nine_source_chip_rail_orders_by_priority", () => {
    const arrival = [
      { label: "ORB", source: "orb_breakout" },
      { label: "Gap", source: "gap_confirm" },
      { label: "News", source: "news_catalyst" },
      { label: "Regime", source: "market_regime" },
      { label: "Sector", source: "sector_alignment" },
      { label: "Market Internals", source: "internals_alignment" },
      { label: "EMA", source: "ema_9_position" },
      { label: "Volume", source: "volume_confirm" },
      { label: "VWAP", source: "vwap_position" }
    ];
    const ranked = rankConflictingSignals(arrival);
    expect(ranked.map((c) => c.label)).toEqual([
      "VWAP",
      "Volume",
      "EMA",
      "Market Internals",
      "Sector",
      "Regime",
      "News",
      "Gap",
      "ORB"
    ]);
  });

  test("test_unknown_source_sorts_to_the_tail_preserving_order", () => {
    const arrival = [
      { label: "Mystery A", source: "future_signal_a" },
      { label: "VWAP", source: "vwap_position" },
      { label: "Mystery B", source: "future_signal_b" }
    ];
    const ranked = rankConflictingSignals(arrival);
    expect(ranked.map((c) => c.label)).toEqual(["VWAP", "Mystery A", "Mystery B"]);
  });

  test("test_missing_source_field_sorts_to_the_tail", () => {
    const arrival = [
      { label: "Legacy chip" },
      { label: "VWAP", source: "vwap_position" }
    ];
    const ranked = rankConflictingSignals(arrival);
    expect(ranked.map((c) => c.label)).toEqual(["VWAP", "Legacy chip"]);
  });

  test("test_stable_sort_for_equal_priority", () => {
    // Two chips with the same source should preserve arrival order.
    const arrival = [
      { label: "VWAP A", source: "vwap_position" },
      { label: "VWAP B", source: "vwap_position" }
    ];
    const ranked = rankConflictingSignals(arrival);
    expect(ranked.map((c) => c.label)).toEqual(["VWAP A", "VWAP B"]);
  });

  test("test_empty_array_returns_empty", () => {
    expect(rankConflictingSignals([])).toEqual([]);
  });

  test("test_does_not_mutate_input", () => {
    const arrival = [
      { label: "EMA", source: "ema_9_position" },
      { label: "VWAP", source: "vwap_position" }
    ];
    const before = arrival.map((c) => c.label).join(",");
    rankConflictingSignals(arrival);
    const after = arrival.map((c) => c.label).join(",");
    expect(after).toBe(before);
  });
});

describe("conflictTierLabel — tier semantics", () => {
  test("test_first_three_get_primary_secondary_tertiary_when_total_is_3", () => {
    expect(conflictTierLabel(0, 3)).toBe("PRIMARY");
    expect(conflictTierLabel(1, 3)).toBe("SECONDARY");
    expect(conflictTierLabel(2, 3)).toBe("TERTIARY");
  });

  test("test_index_past_2_returns_null", () => {
    expect(conflictTierLabel(3, 5)).toBeNull();
    expect(conflictTierLabel(4, 5)).toBeNull();
  });

  test("test_single_conflict_gets_no_label", () => {
    // A single conflict needs no tier label — there is no ranking to
    // communicate. The user said "rank them" — that only applies when
    // there are 2+ conflicts.
    expect(conflictTierLabel(0, 1)).toBeNull();
  });

  test("test_two_conflicts_get_primary_and_secondary", () => {
    expect(conflictTierLabel(0, 2)).toBe("PRIMARY");
    expect(conflictTierLabel(1, 2)).toBe("SECONDARY");
  });

  test("test_negative_index_returns_null", () => {
    expect(conflictTierLabel(-1, 3)).toBeNull();
  });

  test("test_zero_total_returns_null", () => {
    expect(conflictTierLabel(0, 0)).toBeNull();
  });
});
