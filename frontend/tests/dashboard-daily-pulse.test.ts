import { describe, expect, it } from "vitest";
import {
  buildDailyPulseRollup,
  formatDailyPulseDeskHeadline,
  summarizeDailyPulseDesk
} from "@/lib/dashboard-daily-pulse";

describe("summarizeDailyPulseDesk", () => {
  it("counts near ready at 4/6 developing", () => {
    const s = summarizeDailyPulseDesk("swing", {
      AMD: { state: "developing", layers_aligned: 4, layers_total: 6 },
      XYZ: { state: "not_aligned", layers_aligned: 1, layers_total: 6 }
    });
    expect(s?.nearReady).toBe(1);
    expect(s?.notAligned).toBe(1);
    expect(s?.closest[0]?.symbol).toBe("AMD");
    expect(s?.closest[0]?.layersAway).toBe(1);
  });

  it("headline when nothing actionable but near ready", () => {
    const s = summarizeDailyPulseDesk("swing", {
      NVDA: { state: "developing", layers_aligned: 4, layers_total: 6 }
    });
    expect(s && formatDailyPulseDeskHeadline(s)).toBe("Nothing actionable — 1 near ready on Swing");
  });
});

describe("buildDailyPulseRollup", () => {
  it("includes day desk when requested", () => {
    const rollup = buildDailyPulseRollup({
      swingBySymbol: { AAPL: { state: "actionable", layers_aligned: 5, layers_total: 6 } },
      dayBySymbol: { TSLA: { state: "developing", layers_aligned: 3, layers_total: 6 } },
      includeDayDesk: true
    });
    expect(rollup.swing?.actionable).toBe(1);
    expect(rollup.day?.developing).toBe(1);
  });
});
