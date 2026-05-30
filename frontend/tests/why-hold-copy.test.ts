/**
 * Lock-in tests for "Why hold:" / "Why blocked:" rationale copy.
 * Plain English, informational only — must not imply STOCVEST grants trade permission.
 */

import { describe, expect, test } from "vitest";

import {
  deriveDecisionRationale,
  type TradeDecisionState
} from "@/lib/signal-evidence/trade-decision";
import { PLAIN_DECISION_FRAMING } from "@/lib/signal-evidence/decision-copy";

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
  "trade is approved",
  "internal thresholds",
  "structured scenario building",
  "not yet decisive"
];

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

describe("deriveDecisionRationale — risk_reward variant", () => {
  const ctx = { ...FULL_CTX, rr: 0.5, rrFail: true };

  test("test_rr_variant_uses_plain_framing", () => {
    const r = deriveDecisionRationale("monitor", ctx);
    expect(r).not.toBeNull();
    expect(r!.category).toBe("risk_reward");
    expect(r!.text.toLowerCase()).toContain(PLAIN_DECISION_FRAMING);
    assertCleanCopy(r!.text);
  });

  test("test_rr_variant_displays_the_rr_number", () => {
    const r = deriveDecisionRationale("monitor", ctx);
    expect(r!.text).toMatch(/0\.5/);
  });
});

describe("deriveDecisionRationale — readiness fallback", () => {
  test("test_readiness_fallback_copy", () => {
    const r = deriveDecisionRationale("monitor", FULL_CTX);
    expect(r!.category).toBe("readiness");
    expect(r!.text).toContain("Not enough signals agree");
    assertCleanCopy(r!.text);
  });
});

describe("deriveDecisionRationale — every variant passes copy hygiene", () => {
  const cases: Array<{ name: string; state: TradeDecisionState; ctx: typeof FULL_CTX }> = [
    { name: "data_insufficient", state: "blocked", ctx: { ...FULL_CTX, hasInsufficient: true } },
    { name: "risk_reward", state: "monitor", ctx: { ...FULL_CTX, rr: 0.5, rrFail: true } },
    { name: "confirmation", state: "monitor", ctx: { ...FULL_CTX, weakAgreement: true } },
    { name: "regime_counterTrend", state: "monitor", ctx: { ...FULL_CTX, counterTrend: true } },
    { name: "readiness_fallback", state: "monitor", ctx: FULL_CTX }
  ];

  for (const c of cases) {
    test(`test_copy_hygiene_${c.name}`, () => {
      const r = deriveDecisionRationale(c.state, c.ctx);
      expect(r).not.toBeNull();
      assertCleanCopy(r!.text);
    });
  }
});
