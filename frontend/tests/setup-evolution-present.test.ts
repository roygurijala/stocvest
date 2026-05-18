import { describe, expect, test } from "vitest";
import {
  formatMaturationStateLine,
  formatStartedTracking,
  formatTransitionTimelineRow
} from "@/lib/setup-evolution-present";

describe("setup-evolution-present", () => {
  test("developing shows alignment fraction", () => {
    expect(formatMaturationStateLine("developing", 3, 6)).toBe("Developing (3/6)");
  });

  test("formatStartedTracking", () => {
    expect(formatStartedTracking("2026-05-16T12:00:00+00:00")).toMatch(/May 16, 2026/);
  });

  test("timeline row uses session date", () => {
    const row = formatTransitionTimelineRow({
      recorded_at: "2026-05-16T20:00:00+00:00",
      session_date: "2026-05-16",
      from_state: "developing",
      to_state: "developing",
      layers_aligned: 4,
      previous_layers_aligned: 3,
      layers_total: 6,
      alignment_pct: 66.7,
      bias: "long",
      transition_type: "unchanged",
      missing_layers: ["internals"],
      evaluation_source: "evidence"
    });
    expect(row.line).toBe("Near ready (4/6)");
    expect(row.dateLabel).toBe("May 16");
  });
});
