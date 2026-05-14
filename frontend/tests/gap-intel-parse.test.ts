import { describe, expect, test } from "vitest";

import { parseGapIntelSnapshot, type GapIntelSnapshot } from "@/lib/api/gap-intel";

const minimalValid: GapIntelSnapshot = {
  symbol: "AAPL",
  session_date: "2026-05-14",
  computed_at_utc: "2026-05-14T12:00:00Z",
  phase: {
    state: "SESSION",
    label: "Regular session",
    window_start_et: "2026-05-14T09:30:00-04:00",
    window_end_et: "2026-05-14T16:00:00-04:00",
    cadence_seconds: 60
  },
  gap: {
    direction: "UP",
    status: "open",
    resolution_state: "unresolved",
    gap_size_pct: 1.2
  },
  levels: {
    fill_level: 100,
    fill_source: "prior_close",
    fill_reliability: "high"
  },
  liquidity: { is_high_liquidity: true, detail: { adv_usd: 1e9 } },
  scenario_builder: { state: "ENABLED", reasons: [] },
  flags: {
    calendar_state: "open",
    stale: false,
    market_closed: false
  }
};

describe("parseGapIntelSnapshot", () => {
  test("returns null for empty object so catch-all fetch mocks cannot crash the page", () => {
    expect(parseGapIntelSnapshot({})).toBeNull();
    expect(parseGapIntelSnapshot(null)).toBeNull();
  });

  test("accepts a full server-shaped payload", () => {
    expect(parseGapIntelSnapshot(minimalValid)).toEqual(minimalValid);
  });

  test("rejects invalid phase state", () => {
    expect(
      parseGapIntelSnapshot({
        ...minimalValid,
        phase: { ...minimalValid.phase, state: "FAKE_PHASE" }
      })
    ).toBeNull();
  });
});
