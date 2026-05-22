import { describe, expect, test } from "vitest";
import {
  isTimeframeCounterTrend,
  parseTimeframeAlignment,
  parseWeeklyTimeframe,
  resolveTimeframeContext
} from "@/lib/signal-evidence/timeframe-context";

describe("timeframe-context", () => {
  test("parses day desk alignment label", () => {
    const a = parseTimeframeAlignment({
      aligned: false,
      strength: "counter-trend",
      composite_score_modifier: -10,
      label: "Counter-trend: intraday bullish, weekly bearish",
      mode: "day"
    });
    expect(a?.label).toContain("intraday");
    expect(isTimeframeCounterTrend({ weekly: parseWeeklyTimeframe({ weekly_bias: "bearish", weekly_note: "x" })!, alignment: a! })).toBe(true);
  });

  test("resolveTimeframeContext returns null when weekly missing", () => {
    expect(resolveTimeframeContext({ timeframe_alignment: { label: "x", aligned: true, strength: "strong", composite_score_modifier: 0 } }, "day")).toBeNull();
  });

  test("resolveTimeframeContext swing labels", () => {
    const ctx = resolveTimeframeContext(
      {
        weekly_timeframe: {
          weekly_bias: "bullish",
          weekly_change_pct: 2.1,
          weekly_rsi: 55,
          weekly_note: "Weekly change +2.1% vs prior 5 sessions.",
          bars_used: 5
        },
        timeframe_alignment: {
          aligned: true,
          strength: "strong",
          composite_score_modifier: 10,
          label: "Daily and weekly both bullish",
          mode: "swing"
        }
      },
      "swing"
    );
    expect(ctx?.shortHorizonLabel).toBe("Daily structure");
    expect(ctx?.alignment.label).toContain("Daily");
  });
});
