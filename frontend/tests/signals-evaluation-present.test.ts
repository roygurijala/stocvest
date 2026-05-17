import { describe, expect, test, vi } from "vitest";

import {
  buildSignalEvaluationFreshness,
  extractCompositeGeneratedAt,
  formatSignalEvaluationFreshness
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
        tab: "layers",
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
      tab: "layers",
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
