/**
 * Day-side dashboard posture helpers — pure deterministic functions.
 * Locked in so a future refactor can't accidentally collapse the day-side
 * vocabulary into the swing-side helpers (Mode Separation safety perimeter).
 */

import { describe, expect, test } from "vitest";

import {
  buildDayReenableBullets,
  buildDayReenableBulletsShort,
  DAY_DESK_ACTIVE_SCORE_FLOOR,
  dayDeskPostureKind,
  dayDeskSuppressionStatusLine,
  emptyDayOneLiner,
  emptyDayPostureHeadline,
  type DayDeskPostureKind
} from "@/lib/dashboard-posture";

const OPEN = { market: "open", exchanges: {}, currencies: {} };
const CLOSED = { market: "closed", exchanges: {}, currencies: {} };
const EXTENDED = { market: "extended-hours", exchanges: {}, currencies: {} };

describe("dayDeskPostureKind — posture state machine", () => {
  test("posture_scanner_error_overrides_session_and_setup_state", () => {
    expect(
      dayDeskPostureKind({
        marketStatus: OPEN,
        daySetupCount: 5,
        daySetupTopScore: 0.9,
        scannerError: "boom"
      })
    ).toBe<DayDeskPostureKind>("suppressed_scanner_error");
  });

  test("posture_market_closed_is_session_closed_regardless_of_setups", () => {
    // Edge case: scanner returned setups but market is closed. The Day Desk
    // is session-bound — closed-market posture wins.
    expect(
      dayDeskPostureKind({
        marketStatus: CLOSED,
        daySetupCount: 3,
        daySetupTopScore: 0.9
      })
    ).toBe<DayDeskPostureKind>("suppressed_session_closed");
  });

  test("posture_extended_hours_treated_as_session_closed", () => {
    expect(
      dayDeskPostureKind({
        marketStatus: EXTENDED,
        daySetupCount: 0,
        daySetupTopScore: null
      })
    ).toBe<DayDeskPostureKind>("suppressed_session_closed");
  });

  test("posture_market_open_no_setups_is_no_confirmation", () => {
    expect(
      dayDeskPostureKind({
        marketStatus: OPEN,
        daySetupCount: 0,
        daySetupTopScore: null
      })
    ).toBe<DayDeskPostureKind>("suppressed_no_confirmation");
  });

  test("posture_market_open_top_score_at_or_above_floor_is_active", () => {
    expect(
      dayDeskPostureKind({
        marketStatus: OPEN,
        daySetupCount: 2,
        daySetupTopScore: DAY_DESK_ACTIVE_SCORE_FLOOR
      })
    ).toBe<DayDeskPostureKind>("active");
    expect(
      dayDeskPostureKind({
        marketStatus: OPEN,
        daySetupCount: 1,
        daySetupTopScore: 0.92
      })
    ).toBe<DayDeskPostureKind>("active");
  });

  test("posture_market_open_top_score_below_floor_is_monitor", () => {
    expect(
      dayDeskPostureKind({
        marketStatus: OPEN,
        daySetupCount: 2,
        daySetupTopScore: DAY_DESK_ACTIVE_SCORE_FLOOR - 0.01
      })
    ).toBe<DayDeskPostureKind>("monitor");
  });
});

describe("day-vocabulary copy — must NOT leak swing language", () => {
  // Swing-side phrases that the day helpers MUST NEVER produce. Each phrase
  // is anchored to existing swing copy in `lib/dashboard-posture.ts` or
  // `lib/ui-tooltips.ts`. A refactor that mistakenly reuses swing strings
  // for day will fail one of these assertions.
  const SWING_LEAKAGE_PHRASES = [
    "regime alignment",
    "sector confirmation",
    "weekly structure",
    "multi-day structure",
    "DailyBarScanner",
    "EMA200"
  ];

  test("empty_day_posture_headline_uses_day_vocabulary_only", () => {
    const kinds: DayDeskPostureKind[] = [
      "active",
      "monitor",
      "suppressed_session_closed",
      "suppressed_no_confirmation",
      "suppressed_scanner_error"
    ];
    for (const kind of kinds) {
      const text = emptyDayPostureHeadline(kind);
      for (const phrase of SWING_LEAKAGE_PHRASES) {
        expect(text.toLowerCase()).not.toContain(phrase.toLowerCase());
      }
      // Active variant explicitly says "Day Desk".
      expect(text.toLowerCase()).toContain("day desk");
    }
  });

  test("empty_day_one_liner_extended_hours_explicitly_called_out", () => {
    // Extended-hours is a distinct case from regular session closed —
    // the one-liner must surface the extended-hours framing so the user
    // doesn't read "closed" and assume weekend / holiday.
    const line = emptyDayOneLiner("suppressed_session_closed", EXTENDED);
    expect(line.toLowerCase()).toContain("extended");
  });

  test("day_desk_suppression_status_line_distinguishes_session_vs_confirmation", () => {
    expect(dayDeskSuppressionStatusLine("suppressed_session_closed").toLowerCase()).toContain(
      "outside regular session"
    );
    expect(dayDeskSuppressionStatusLine("suppressed_no_confirmation").toLowerCase()).toContain(
      "intraday confirmation absent"
    );
  });

  test("buildDayReenableBullets_uses_day_vocabulary_in_both_open_and_closed_branches", () => {
    const open = buildDayReenableBullets({ marketStatus: OPEN, daySetupCount: 0 });
    const closed = buildDayReenableBullets({ marketStatus: CLOSED, daySetupCount: 0 });
    expect(open).toHaveLength(3);
    expect(closed).toHaveLength(3);

    const allText = [...open, ...closed].join(" | ").toLowerCase();
    // Day-vocabulary tokens present.
    expect(allText).toContain("volume");
    expect(allText).toContain("momentum");
    expect(allText).toMatch(/session|intraday|orb/);
    // Swing-vocabulary tokens absent.
    for (const phrase of SWING_LEAKAGE_PHRASES) {
      expect(allText).not.toContain(phrase.toLowerCase());
    }
  });

  test("buildDayReenableBulletsShort_returns_three_distinct_bullets", () => {
    const bullets = buildDayReenableBulletsShort({ marketStatus: OPEN, daySetupCount: 0 });
    expect(bullets).toHaveLength(3);
    const unique = new Set(bullets);
    expect(unique.size).toBe(3);
  });
});
