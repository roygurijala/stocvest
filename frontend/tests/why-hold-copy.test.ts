/**
 * Lock-in tests for the "Why hold:" / "Why blocked:" rationale copy
 * rewrite (BRK.B feedback, 2026-05-13).
 *
 * The user reported that the previous wording read like STOCVEST was
 * claiming gatekeeper authority — phrases like "STOCVEST requires
 * favorable asymmetry before granting trade permission" implied the
 * platform was the entity deciding whether the user was *allowed* to
 * trade. That is the exact implication our legal posture is built to
 * avoid.
 *
 * These tests enforce the new framing:
 *
 *   - Every rationale variant frames the gate as an *internal threshold
 *     for structured scenario building*, not as trade approval.
 *   - The phrase "granting trade permission" is forbidden anywhere in
 *     the rationale output.
 *   - The phrase "requires favorable asymmetry" is forbidden (it shifted
 *     the gate from "internal threshold" to "STOCVEST will not allow").
 *   - The phrase "requires regime alignment" is forbidden (same reason).
 *   - The phrase "requires clearer directional confirmation" is forbidden.
 *   - The phrase "waits for ... before granting" is forbidden.
 *
 * Failing these is a copy regression — the BRK.B fix is meant to be
 * permanent.
 */

import { describe, expect, test } from "vitest";

import {
  deriveDecisionRationale,
  type TradeDecisionState
} from "@/lib/signal-evidence/trade-decision";

const FORBIDDEN_PHRASES = [
  "granting trade permission",
  "requires favorable asymmetry",
  "requires regime alignment",
  "requires clearer directional confirmation",
  "waits for complete signal data before granting",
  "waits for clearer confirmation before granting",
  "stocvest requires",
  "we do not recommend",
  "we recommend",
  "approved",
  "trade is approved"
];

const REQUIRED_FRAMING = "internal thresholds for structured scenario building";

const FULL_CTX = {
  rr: 2.5,
  rrFail: false,
  hasInsufficient: false,
  coverageThin: false,
  weakAgreement: false,
  counterTrend: false,
  regimeConflict: false
};

function assertCleanCopy(text: string) {
  const lower = text.toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    expect(lower).not.toContain(phrase);
  }
}

describe("deriveDecisionRationale — actionable state returns null", () => {
  test("test_actionable_state_returns_null", () => {
    const r = deriveDecisionRationale("actionable", FULL_CTX);
    expect(r).toBeNull();
  });
});

describe("deriveDecisionRationale — risk_reward variant (BRK.B Issue 2)", () => {
  const ctx = { ...FULL_CTX, rr: 0.5, rrFail: true };

  test("test_rr_variant_uses_internal_thresholds_framing", () => {
    const r = deriveDecisionRationale("monitor", ctx);
    expect(r).not.toBeNull();
    expect(r!.category).toBe("risk_reward");
    expect(r!.text.toLowerCase()).toContain(REQUIRED_FRAMING);
  });

  test("test_rr_variant_displays_the_rr_number", () => {
    const r = deriveDecisionRationale("monitor", ctx);
    expect(r!.text).toMatch(/0\.5/);
  });

  test("test_rr_variant_uses_why_hold_label_in_monitor_state", () => {
    const r = deriveDecisionRationale("monitor", ctx);
    expect(r!.label).toBe("Why hold:");
  });

  test("test_rr_variant_uses_why_blocked_label_in_blocked_state", () => {
    const r = deriveDecisionRationale("blocked", ctx);
    expect(r!.label).toBe("Why blocked:");
  });

  test("test_rr_variant_drops_granting_trade_permission_phrasing", () => {
    const r = deriveDecisionRationale("monitor", ctx);
    assertCleanCopy(r!.text);
  });

  test("test_rr_variant_brk_b_regression", () => {
    // Exact BRK.B scenario from the screenshot: 0.5:1 R/R, monitor
    // state. The text must reference the R/R number AND use the
    // internal-thresholds framing — NEVER the legacy "granting trade
    // permission" wording.
    const r = deriveDecisionRationale("monitor", { ...FULL_CTX, rr: 0.5, rrFail: true });
    expect(r!.text).toMatch(/0\.5:1/);
    expect(r!.text.toLowerCase()).toContain("internal thresholds");
    expect(r!.text.toLowerCase()).not.toContain("granting trade permission");
    expect(r!.text.toLowerCase()).not.toContain("favorable asymmetry");
  });
});

describe("deriveDecisionRationale — data_insufficient variant", () => {
  const ctx = { ...FULL_CTX, hasInsufficient: true };

  test("test_data_insufficient_uses_internal_thresholds_framing", () => {
    const r = deriveDecisionRationale("blocked", ctx);
    expect(r!.category).toBe("data_insufficient");
    expect(r!.text.toLowerCase()).toContain(REQUIRED_FRAMING);
  });

  test("test_data_insufficient_drops_granting_trade_permission_phrasing", () => {
    assertCleanCopy(deriveDecisionRationale("blocked", ctx)!.text);
    assertCleanCopy(deriveDecisionRationale("monitor", ctx)!.text);
  });

  test("test_coverage_thin_also_routes_to_data_insufficient", () => {
    const r = deriveDecisionRationale("blocked", { ...FULL_CTX, coverageThin: true });
    expect(r!.category).toBe("data_insufficient");
    assertCleanCopy(r!.text);
  });
});

describe("deriveDecisionRationale — confirmation variant", () => {
  const ctx = { ...FULL_CTX, weakAgreement: true };

  test("test_confirmation_uses_internal_thresholds_framing", () => {
    const r = deriveDecisionRationale("monitor", ctx);
    expect(r!.category).toBe("confirmation");
    expect(r!.text.toLowerCase()).toContain(REQUIRED_FRAMING);
  });

  test("test_confirmation_drops_granting_trade_permission_phrasing", () => {
    assertCleanCopy(deriveDecisionRationale("monitor", ctx)!.text);
    assertCleanCopy(deriveDecisionRationale("blocked", ctx)!.text);
  });
});

describe("deriveDecisionRationale — regime variant", () => {
  test("test_regime_counter_trend_uses_internal_thresholds_framing", () => {
    const r = deriveDecisionRationale("monitor", { ...FULL_CTX, counterTrend: true });
    expect(r!.category).toBe("regime");
    expect(r!.text.toLowerCase()).toContain(REQUIRED_FRAMING);
  });

  test("test_regime_conflict_uses_internal_thresholds_framing", () => {
    const r = deriveDecisionRationale("monitor", { ...FULL_CTX, regimeConflict: true });
    expect(r!.category).toBe("regime");
    expect(r!.text.toLowerCase()).toContain(REQUIRED_FRAMING);
  });

  test("test_regime_drops_granting_trade_permission_phrasing", () => {
    const r = deriveDecisionRationale("monitor", { ...FULL_CTX, counterTrend: true });
    assertCleanCopy(r!.text);
  });
});

describe("deriveDecisionRationale — readiness fallback variant", () => {
  test("test_readiness_fallback_uses_internal_thresholds_framing", () => {
    // No specific gate trips — readiness fallback covers the remainder.
    const r = deriveDecisionRationale("monitor", FULL_CTX);
    expect(r!.category).toBe("readiness");
    expect(r!.text.toLowerCase()).toContain(REQUIRED_FRAMING);
  });

  test("test_readiness_drops_granting_trade_permission_phrasing", () => {
    assertCleanCopy(deriveDecisionRationale("monitor", FULL_CTX)!.text);
    assertCleanCopy(deriveDecisionRationale("blocked", FULL_CTX)!.text);
  });
});

describe("deriveDecisionRationale — every variant passes the copy-hygiene gate", () => {
  // Exhaustive sweep: enumerate the rationale category space and assert
  // none of them carry the legacy "granting trade permission" copy.

  const cases: Array<{ name: string; state: TradeDecisionState; ctx: typeof FULL_CTX }> = [
    { name: "data_insufficient_via_hasInsufficient", state: "blocked", ctx: { ...FULL_CTX, hasInsufficient: true } },
    { name: "data_insufficient_via_coverageThin", state: "blocked", ctx: { ...FULL_CTX, coverageThin: true } },
    { name: "risk_reward", state: "monitor", ctx: { ...FULL_CTX, rr: 0.5, rrFail: true } },
    { name: "confirmation_weakAgreement", state: "monitor", ctx: { ...FULL_CTX, weakAgreement: true } },
    { name: "regime_counterTrend", state: "monitor", ctx: { ...FULL_CTX, counterTrend: true } },
    { name: "regime_regimeConflict", state: "monitor", ctx: { ...FULL_CTX, regimeConflict: true } },
    { name: "readiness_fallback", state: "monitor", ctx: FULL_CTX }
  ];

  for (const c of cases) {
    test(`test_copy_hygiene_${c.name}`, () => {
      const r = deriveDecisionRationale(c.state, c.ctx);
      expect(r).not.toBeNull();
      assertCleanCopy(r!.text);
      // Every variant must carry the required framing somewhere.
      expect(r!.text.toLowerCase()).toContain(REQUIRED_FRAMING);
    });
  }
});
