import { describe, expect, test } from "vitest";
import {
  alignmentDisplayMeta,
  formatAlignmentStatusLine,
  formatLayersFromActionableHint,
  formatWatchlistMaturationDisplayLine,
  formatWatchlistProgressionChip,
  layersAwayFromActionable,
  resolveAlignmentDisplayTier
} from "@/lib/alignment-display-tier";

describe("resolveAlignmentDisplayTier", () => {
  test("0-1 aligned → not_aligned", () => {
    expect(resolveAlignmentDisplayTier({ layersAligned: 0 })).toBe("not_aligned");
    expect(resolveAlignmentDisplayTier({ layersAligned: 1 })).toBe("not_aligned");
  });

  test("2-3 aligned → developing", () => {
    expect(resolveAlignmentDisplayTier({ layersAligned: 2 })).toBe("developing");
    expect(resolveAlignmentDisplayTier({ layersAligned: 3 })).toBe("developing");
  });

  test("4 aligned → near_ready (backend may still be developing)", () => {
    expect(resolveAlignmentDisplayTier({ layersAligned: 4, maturationState: "developing" })).toBe("near_ready");
  });

  test("5-6 aligned → actionable", () => {
    expect(resolveAlignmentDisplayTier({ layersAligned: 5 })).toBe("actionable");
    expect(resolveAlignmentDisplayTier({ layersAligned: 6 })).toBe("actionable");
    expect(resolveAlignmentDisplayTier({ layersAligned: 5, maturationState: "actionable" })).toBe("actionable");
  });

  test("invalidated maturation wins over alignment count", () => {
    expect(resolveAlignmentDisplayTier({ layersAligned: 6, maturationState: "invalidated" })).toBe("invalidated");
  });
});

describe("formatAlignmentStatusLine", () => {
  test("near ready shows ratio", () => {
    expect(formatAlignmentStatusLine({ layersAligned: 4, maturationState: "developing" })).toBe("Near ready (4/6)");
  });

  test("not aligned omits ratio at 0-1", () => {
    expect(formatAlignmentStatusLine({ layersAligned: 1 })).toBe("Not aligned");
  });
});

describe("layersAwayFromActionable", () => {
  test("4/6 is one layer away from actionable band", () => {
    expect(layersAwayFromActionable(4)).toBe(1);
  });

  test("at actionable threshold returns 0", () => {
    expect(layersAwayFromActionable(5)).toBe(0);
  });
});

describe("alignmentDisplayMeta", () => {
  test("near ready uses yellow emoji", () => {
    const m = alignmentDisplayMeta({ layersAligned: 4 });
    expect(m.emoji).toBe("🟡");
    expect(m.tone).toBe("near");
  });
});

describe("formatWatchlistMaturationDisplayLine", () => {
  test("developing at 4/6 → Near ready", () => {
    expect(
      formatWatchlistMaturationDisplayLine({
        state: "developing",
        layers_aligned: 4,
        layers_total: 6
      })
    ).toBe("Near ready (4/6)");
  });

  test("falls back to label when counts missing", () => {
    expect(formatWatchlistMaturationDisplayLine({ state: "re_evaluating" })).toBe("re evaluating");
  });
});

describe("formatLayersFromActionableHint", () => {
  test("4/6 is one layer away", () => {
    expect(formatLayersFromActionableHint(4)).toBe("one layer from actionable threshold");
  });

  test("actionable band returns null", () => {
    expect(formatLayersFromActionableHint(5)).toBeNull();
  });
});

describe("formatWatchlistProgressionChip", () => {
  test("improved shows up arrow from prior count", () => {
    expect(
      formatWatchlistProgressionChip({
        layers_aligned: 4,
        layers_total: 6,
        previous_layers_aligned: 3,
        last_transition_type: "improved"
      })
    ).toBe("↑ from 3/6");
  });

  test("worsened shows down arrow", () => {
    expect(
      formatWatchlistProgressionChip({
        layers_aligned: 2,
        layers_total: 6,
        previous_layers_aligned: 4,
        last_transition_type: "worsened"
      })
    ).toBe("↓ from 4/6");
  });

  test("unchanged or missing prior returns null", () => {
    expect(
      formatWatchlistProgressionChip({
        layers_aligned: 4,
        last_transition_type: "unchanged"
      })
    ).toBeNull();
  });
});
