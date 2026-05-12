/**
 * Lock-in tests for the Evidence-card mode-resolution rules.
 *
 * These rules sit at the seam between the Scanner / Dashboard React components
 * and `enrichEvidenceWithComposite(evidence, mode)`. They look trivial in
 * isolation but were silently violated for months until B30 Phase 1 surfaced
 * the bug — every Evidence-modal open from the Scanner gap card, Scanner
 * setup card, and Dashboard Swing Desk row was hard-coded to the day engine
 * regardless of the row's actual mode. The fix was a one-line ternary at each
 * call site; this module pulls that ternary out into a named contract and
 * locks every branch in here so the same regression cannot survive a future
 * refactor.
 *
 * Contract:
 *   resolveEvidenceTradingMode("day")    === "day"
 *   resolveEvidenceTradingMode("swing")  === "swing"
 *   resolveEvidenceTradingMode("both")   === "swing"   (B30 product call)
 *
 *   resolveSetupRowTradingMode("swing", fb)       === "swing"
 *   resolveSetupRowTradingMode("swing-only", fb)  === "swing"
 *   resolveSetupRowTradingMode("day", fb)         === "day"
 *   resolveSetupRowTradingMode("day-only", fb)    === "day"
 *   resolveSetupRowTradingMode("other", fb)       === fb     (defensive fallback)
 */
import { describe, expect, test } from "vitest";

import {
  resolveEvidenceTradingMode,
  resolveGapCardTradingMode,
  resolveSetupRowTradingMode,
  type EvidenceTradingMode
} from "@/lib/scanner-mode-resolution";

describe("resolveEvidenceTradingMode — top-level scanner mode collapse", () => {
  test("scannerSetupMode 'day' resolves to 'day'", () => {
    expect(resolveEvidenceTradingMode("day")).toBe("day");
  });

  test("scannerSetupMode 'swing' resolves to 'swing'", () => {
    expect(resolveEvidenceTradingMode("swing")).toBe("swing");
  });

  test("scannerSetupMode 'both' collapses to 'swing' (swing-first product decision)", () => {
    expect(resolveEvidenceTradingMode("both")).toBe("swing");
  });

  test("matches panelNewsTradingMode pattern (day -> day, anything else -> swing)", () => {
    // This invariant is load-bearing — keeping news lookback and composite
    // engine in lockstep is what guarantees the news the user reads is tagged
    // with the same horizon as the verdict that produced the modal.
    const modes = ["day", "swing", "both"] as const;
    for (const m of modes) {
      const resolved = resolveEvidenceTradingMode(m);
      const newsPattern: EvidenceTradingMode = m === "day" ? "day" : "swing";
      expect(resolved).toBe(newsPattern);
    }
  });
});

describe("resolveSetupRowTradingMode — per-row group-key disambiguation", () => {
  const swingFallback: EvidenceTradingMode = "swing";
  const dayFallback: EvidenceTradingMode = "day";

  test("swing group key resolves to 'swing' regardless of fallback", () => {
    expect(resolveSetupRowTradingMode("swing", swingFallback)).toBe("swing");
    expect(resolveSetupRowTradingMode("swing", dayFallback)).toBe("swing");
  });

  test("swing-only group key resolves to 'swing' regardless of fallback", () => {
    expect(resolveSetupRowTradingMode("swing-only", swingFallback)).toBe("swing");
    expect(resolveSetupRowTradingMode("swing-only", dayFallback)).toBe("swing");
  });

  test("day group key resolves to 'day' regardless of fallback", () => {
    expect(resolveSetupRowTradingMode("day", swingFallback)).toBe("day");
    expect(resolveSetupRowTradingMode("day", dayFallback)).toBe("day");
  });

  test("day-only group key resolves to 'day' regardless of fallback", () => {
    expect(resolveSetupRowTradingMode("day-only", swingFallback)).toBe("day");
    expect(resolveSetupRowTradingMode("day-only", dayFallback)).toBe("day");
  });

  test("day-group rows in scannerSetupMode === 'both' override the 'both -> swing' fallback", () => {
    // This is the load-bearing invariant for the merged "both" view.
    // The top-level fallback collapses "both" → swing, but a day-group row
    // MUST flip to "day" so the day engine answers.
    const bothFallback = resolveEvidenceTradingMode("both"); // "swing"
    expect(resolveSetupRowTradingMode("day", bothFallback)).toBe("day");
  });

  test("swing-group rows in scannerSetupMode === 'day' override the day fallback", () => {
    // Symmetric guard — if a swing group somehow appears under a day-mode
    // scanner (no such case today, but a future product change might), the
    // per-row rule still wins.
    expect(resolveSetupRowTradingMode("swing", "day")).toBe("swing");
  });

  test("unknown group key falls back to the provided fallback", () => {
    expect(resolveSetupRowTradingMode("intermarket", swingFallback)).toBe("swing");
    expect(resolveSetupRowTradingMode("intermarket", dayFallback)).toBe("day");
    expect(resolveSetupRowTradingMode("", swingFallback)).toBe("swing");
  });

  test("prefix match is case-sensitive (group keys are lower-cased by contract)", () => {
    // The SetupRenderGroup.key union is "swing" | "day" | "swing-only" | "day-only"
    // — all lower-case literals. An accidental "Swing" or "DAY" from a future
    // refactor would NOT prefix-match here and would silently fall back. This
    // test pins that behavior so the regression is visible if a caller starts
    // sending mixed-case keys.
    expect(resolveSetupRowTradingMode("Swing", "day")).toBe("day");
    expect(resolveSetupRowTradingMode("DAY", "swing")).toBe("swing");
  });
});

describe("resolveGapCardTradingMode — per-gap-row classifier-driven routing (B30 Phase 4)", () => {
  test("explicit scannerSetupMode 'day' wins regardless of classifier verdict", () => {
    // Explicit user context ALWAYS overrides advisory classifier verdict.
    expect(resolveGapCardTradingMode("day", "swing")).toBe("day");
    expect(resolveGapCardTradingMode("day", "day")).toBe("day");
    expect(resolveGapCardTradingMode("day", "either")).toBe("day");
    expect(resolveGapCardTradingMode("day", undefined)).toBe("day");
  });

  test("explicit scannerSetupMode 'swing' wins regardless of classifier verdict", () => {
    expect(resolveGapCardTradingMode("swing", "swing")).toBe("swing");
    expect(resolveGapCardTradingMode("swing", "day")).toBe("swing");
    expect(resolveGapCardTradingMode("swing", "either")).toBe("swing");
    expect(resolveGapCardTradingMode("swing", undefined)).toBe("swing");
  });

  test("'both' view honors classifier 'swing' verdict", () => {
    expect(resolveGapCardTradingMode("both", "swing")).toBe("swing");
  });

  test("'both' view honors classifier 'day' verdict (cross-engine routing)", () => {
    // This is the load-bearing branch — in 'both' view, a day-leaning gap row
    // MUST open the day engine even though the top-level fallback for 'both'
    // is swing. Without this branch, every gap card on the 'both' view would
    // open the swing engine and the classifier output would be cosmetic.
    expect(resolveGapCardTradingMode("both", "day")).toBe("day");
  });

  test("'both' view with 'either' verdict falls back to swing (preserves prior default)", () => {
    expect(resolveGapCardTradingMode("both", "either")).toBe("swing");
  });

  test("'both' view with undefined verdict (legacy / cached response) falls back to swing", () => {
    // Back-compat: cached gap-intelligence responses from before B30 Phase 4
    // don't carry mode_best_fit. Those rows MUST behave like the pre-Phase-4
    // 'both → swing' default so no user-visible regression appears during the
    // cache TTL window.
    expect(resolveGapCardTradingMode("both", undefined)).toBe("swing");
  });
});
