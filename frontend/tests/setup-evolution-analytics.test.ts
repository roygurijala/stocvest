import { describe, expect, test } from "vitest";
import {
  evolutionJourneyStateLabel,
  formatDurationDays,
  formatEvolutionSessionDate,
  groupTimelineByWeek,
  sparklinePath,
  thresholdY
} from "@/lib/setup-evolution-analytics";

describe("setup-evolution-analytics", () => {
  test("evolutionJourneyStateLabel maps maturation tiers", () => {
    expect(evolutionJourneyStateLabel("not_aligned", 1)).toBe("Potential");
    expect(evolutionJourneyStateLabel("developing", 3)).toBe("Potential");
    expect(evolutionJourneyStateLabel("developing", 4)).toBe("Near");
    expect(evolutionJourneyStateLabel("actionable", 5)).toBe("Actionable");
    expect(evolutionJourneyStateLabel("invalidated", 2)).toBe("Cooling");
  });

  test("sparklinePath builds line and dots", () => {
    const { line, dots } = sparklinePath(
      [
        { session_date: "2026-06-08", signal_score: 40, to_state: "developing", layers_aligned: 3, layers_total: 6 },
        { session_date: "2026-06-09", signal_score: 55, to_state: "developing", layers_aligned: 4, layers_total: 6 },
        { session_date: "2026-06-10", signal_score: 72, to_state: "actionable", layers_aligned: 5, layers_total: 6 }
      ],
      100,
      50
    );
    expect(line).toMatch(/^M/);
    expect(dots).toHaveLength(3);
    expect(dots[0].score).toBe(40);
    expect(dots[2].score).toBe(72);
  });

  test("thresholdY places actionable band", () => {
    const y = thresholdY(72, 100);
    expect(y).toBeGreaterThan(8);
    expect(y).toBeLessThan(92);
  });

  test("formatDurationDays", () => {
    expect(formatDurationDays(0)).toBe("<1d");
    expect(formatDurationDays(1)).toBe("1d");
    expect(formatDurationDays(3)).toBe("3d");
    expect(formatDurationDays(null)).toBe("—");
  });

  test("groupTimelineByWeek buckets rows", () => {
    const weeks = groupTimelineByWeek([
      {
        session_date: "2026-06-09",
        signal_score: 50,
        score_delta: 5,
        delta_label: "+5pts",
        to_state: "developing",
        state_changed: false,
        dot: "●",
        summary: "Score improved"
      },
      {
        session_date: "2026-06-10",
        signal_score: 58,
        score_delta: 8,
        delta_label: "+8pts",
        to_state: "developing",
        state_changed: false,
        dot: "●",
        summary: "Layers improved"
      }
    ]);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].rows).toHaveLength(2);
    expect(formatEvolutionSessionDate("2026-06-10")).toMatch(/Jun/);
  });
});
