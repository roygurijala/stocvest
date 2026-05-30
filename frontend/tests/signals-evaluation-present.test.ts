import { describe, expect, test, vi } from "vitest";

import {
  buildSignalEvaluationFreshness,
  extractCompositeGeneratedAt,
  formatSignalEvaluationFreshness,
  formatSignalsModeEvaluatedSegment,
  signalsDeskModeTooltip
} from "@/lib/signals-evaluation-present";

describe("extractCompositeGeneratedAt", () => {
  test("prefers generated_at over timestamp_iso", () => {
    expect(
      extractCompositeGeneratedAt({
        generated_at: "2026-05-16T10:00:00Z",
        timestamp_iso: "2026-05-15T10:00:00Z"
      })
    ).toBe("2026-05-16T10:00:00Z");
  });
});

describe("formatSignalEvaluationFreshness", () => {
  test("missing timestamp → Evaluating…", () => {
    expect(formatSignalEvaluationFreshness(null)).toBe("Evaluating…");
    expect(formatSignalEvaluationFreshness("")).toBe("Evaluating…");
  });

  test("recent timestamp → Evaluated just now", () => {
    const now = Date.parse("2026-05-16T12:00:00Z");
    vi.setSystemTime(now);
    expect(formatSignalEvaluationFreshness("2026-05-16T11:59:30Z", { now })).toBe("Evaluated just now");
    vi.useRealTimers();
  });

  test("older timestamp → Last evaluated with formatted time", () => {
    const now = Date.parse("2026-05-16T12:00:00Z");
    const label = formatSignalEvaluationFreshness("2026-05-16T08:00:00Z", { now });
    expect(label.startsWith("Last evaluated:")).toBe(true);
  });
});

describe("buildSignalEvaluationFreshness", () => {
  test("loading → refreshing copy", () => {
    expect(
      buildSignalEvaluationFreshness({
        symbolCommitted: true,
        isInitialLoading: true,
        isRevalidating: false,
        isMountRevalidating: false,
        composite: null,
        isInsufficient: false
      })
    ).toEqual({
      phase: "loading",
      label: "Refreshing latest market state…"
    });
  });

  test("ready composite → evaluated label", () => {
    const now = Date.parse("2026-05-16T12:00:00Z");
    vi.setSystemTime(now);
    const freshness = buildSignalEvaluationFreshness({
      symbolCommitted: true,
      isInitialLoading: false,
      isRevalidating: false,
      isMountRevalidating: false,
      composite: { generated_at: "2026-05-16T11:59:50Z", layers: [] },
      isInsufficient: false
    });
    expect(freshness?.phase).toBe("ready");
    expect(freshness?.label).toBe("Evaluated just now");
    vi.useRealTimers();
  });
});

describe("formatSignalsModeEvaluatedSegment", () => {
  test("strips colon from Last evaluated label", () => {
    expect(
      formatSignalsModeEvaluatedSegment({
        phase: "ready",
        label: "Last evaluated: May 21, 4:11 PM ET"
      })
    ).toBe("Last evaluated May 21, 4:11 PM ET");
  });

  test("maps just now to Last evaluated just now", () => {
    expect(
      formatSignalsModeEvaluatedSegment({ phase: "ready", label: "Evaluated just now" })
    ).toBe("Last evaluated just now");
  });
});

describe("signalsDeskModeTooltip", () => {
  test("day tooltip includes structure and refresh lines", () => {
    const tip = signalsDeskModeTooltip("day");
    expect(tip).toContain("live session structure");
    expect(tip).toContain("Dashboard");
    expect(tip).toContain("Watchlists");
    expect(tip).toContain("Signals update when you open");
  });
});

describe("formatSignalsModeEvaluatedSegment", () => {
  test("strips colon from Last evaluated label", () => {
    expect(
      formatSignalsModeEvaluatedSegment({
        phase: "ready",
        label: "Last evaluated: May 21, 4:11 PM ET"
      })
    ).toBe("Last evaluated May 21, 4:11 PM ET");
  });

  test("maps just now to Last evaluated just now", () => {
    expect(
      formatSignalsModeEvaluatedSegment({ phase: "ready", label: "Evaluated just now" })
    ).toBe("Last evaluated just now");
  });
});

describe("signalsDeskModeTooltip", () => {
  test("day tooltip includes structure and refresh lines", () => {
    const tip = signalsDeskModeTooltip("day");
    expect(tip).toContain("live session structure");
    expect(tip).toContain("Dashboard");
    expect(tip).toContain("Watchlists");
    expect(tip).toContain("Signals update when you open");
  });
});
