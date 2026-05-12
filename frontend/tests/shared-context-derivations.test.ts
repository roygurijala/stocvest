/**
 * Shared Context master card — pure derivation helpers (Mode Separation B28 Phase 2b).
 *
 * The five sub-sections inside the Shared Context master card render category
 * labels (Volatility / Participation / Risk Horizon) derived from raw market
 * inputs, plus a single Environment Summary sentence that joins them. The
 * derivation rules are non-negotiable per the user directive:
 *
 *   - Volatility is CATEGORY-ONLY (Contained / Expanding / Compressed) — no
 *     ATR numbers. Driven by VIX level + VIX session %.
 *   - Participation requires BOTH sector breadth AND index breadth to call
 *     "Broad"; a single benchmark surge with thin sector follow-through
 *     must NOT classify as Broad (that's the "narrow leadership trap").
 *   - Risk Horizon is TIME-BASED, not directional. Macro warning beats
 *     earnings count beats absence.
 *   - Environment Summary is strategy-agnostic — describes what the
 *     environment IS, not what to do about it. Banned words enforced.
 *
 * This test file locks in the deterministic boundary behavior so a future
 * threshold tweak shows up as an explicit test diff, not a silent visual
 * regression on the dashboard.
 */

import { describe, expect, test } from "vitest";
import {
  classifyVolatility,
  classifyParticipation,
  classifyRiskHorizon,
  volatilityPlainLine,
  participationPlainLine,
  riskHorizonPlainLine,
  buildEnvironmentSummary
} from "@/components/shared-context-master-card";
import type { EarningsEvent } from "@/lib/api/earnings";

const NO_EARNINGS: EarningsEvent[] = [];
function earnings(count: number): EarningsEvent[] {
  const list: EarningsEvent[] = [];
  for (let i = 0; i < count; i++) {
    list.push({ symbol: `T${i}`, company_name: "Test", report_date: "2026-05-15", report_time: "after_market" });
  }
  return list;
}

// ─────────────────────────────────────────────────────────────────────────────
// Volatility
// ─────────────────────────────────────────────────────────────────────────────

describe("classifyVolatility (Phase 2b)", () => {
  test("returns Unknown when both level and pct are missing", () => {
    expect(classifyVolatility(null, null)).toBe("Unknown");
    expect(classifyVolatility(undefined, undefined)).toBe("Unknown");
  });

  test("returns Expanding when VIX level >= 22 even if pct is calm", () => {
    expect(classifyVolatility(23, 0.5)).toBe("Expanding");
  });

  test("returns Expanding when VIX pct >= 5 even if level is calm", () => {
    expect(classifyVolatility(15, 6)).toBe("Expanding");
  });

  test("returns Compressed when VIX level <= 13 even if pct is mildly negative", () => {
    expect(classifyVolatility(12, -1)).toBe("Compressed");
  });

  test("returns Compressed when VIX pct <= -5 even if level is mid-range", () => {
    expect(classifyVolatility(18, -6)).toBe("Compressed");
  });

  test("returns Contained when VIX level mid-range and pct quiet", () => {
    expect(classifyVolatility(17, 0.5)).toBe("Contained");
  });

  test("threshold boundary: VIX level exactly 22 -> Expanding", () => {
    expect(classifyVolatility(22, 0)).toBe("Expanding");
  });

  test("threshold boundary: VIX level exactly 13 -> Compressed", () => {
    expect(classifyVolatility(13, 0)).toBe("Compressed");
  });

  test("plain line never mentions ATR numbers", () => {
    for (const cat of ["Contained", "Expanding", "Compressed", "Unknown"] as const) {
      const line = volatilityPlainLine(cat).toLowerCase();
      expect(line).not.toContain("atr");
      expect(line).not.toMatch(/\d/); // no numbers per user directive
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Participation
// ─────────────────────────────────────────────────────────────────────────────

describe("classifyParticipation (Phase 2b)", () => {
  test("returns Unknown when both sector and index inputs are empty", () => {
    expect(classifyParticipation([], [])).toBe("Unknown");
    expect(classifyParticipation([null, null], [null, null, null])).toBe("Unknown");
  });

  test("returns Broad only when BOTH sector breadth AND index breadth are positive", () => {
    expect(
      classifyParticipation(
        [1.5, 1.2, 0.8, 0.6, 1.0],
        [1.2, 0.9, 0.8]
      )
    ).toBe("Broad");
  });

  test("anti-leak: single benchmark surge with thin sector follow-through is NOT Broad", () => {
    // The canonical "narrow leadership trap" — a few benchmarks up but
    // sectors flat-to-down. Must classify as Mixed (or Narrow), never Broad.
    const result = classifyParticipation(
      [1.5, -0.1, -0.3, -0.2, 0.1], // only 2 of 5 sectors positive
      [1.2, 0.9, 0.8] // all 3 indices positive
    );
    expect(result).not.toBe("Broad");
  });

  test("returns Narrow when nearly all sectors AND all indices are weak", () => {
    expect(
      classifyParticipation(
        [-1.5, -1.2, -0.8, -0.6, -1.0],
        [-1.2, -0.9, -0.8]
      )
    ).toBe("Narrow");
  });

  test("returns Mixed in the middle band", () => {
    expect(
      classifyParticipation(
        [1.0, 0.5, -0.5, -0.3, 0.2],
        [0.5, 0.3, -0.2]
      )
    ).toBe("Mixed");
  });

  test("plain line for Broad mentions both indices AND sectors participating", () => {
    const line = participationPlainLine("Broad").toLowerCase();
    expect(line).toContain("indices");
    expect(line).toContain("sectors");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Risk Horizon
// ─────────────────────────────────────────────────────────────────────────────

describe("classifyRiskHorizon (Phase 2b)", () => {
  test("Elevated wins when macro warning present even with zero earnings", () => {
    expect(classifyRiskHorizon(NO_EARNINGS, "High-impact Fed event in 7 days")).toBe("Elevated");
  });

  test("Elevated wins when macro warning present even with many earnings", () => {
    expect(classifyRiskHorizon(earnings(10), "CPI print this week")).toBe("Elevated");
  });

  test("Active when 4+ earnings AND no macro warning", () => {
    expect(classifyRiskHorizon(earnings(5), null)).toBe("Active");
  });

  test("Active threshold boundary: exactly 4 earnings -> Active", () => {
    expect(classifyRiskHorizon(earnings(4), null)).toBe("Active");
  });

  test("Quiet when 1-3 earnings AND no macro warning", () => {
    expect(classifyRiskHorizon(earnings(3), null)).toBe("Quiet");
    expect(classifyRiskHorizon(earnings(1), null)).toBe("Quiet");
  });

  test("Quiet when no earnings AND no macro warning", () => {
    expect(classifyRiskHorizon(NO_EARNINGS, null)).toBe("Quiet");
    expect(classifyRiskHorizon(NO_EARNINGS, "")).toBe("Quiet");
  });

  test("plain line for Elevated returns the macro warning verbatim", () => {
    const warning = "High-impact Fed event in 7 days";
    expect(riskHorizonPlainLine("Elevated", 2, warning)).toBe(warning);
  });

  test("plain line for Quiet+0 earnings mentions absence of macro prints in next 7 sessions", () => {
    const line = riskHorizonPlainLine("Quiet", 0, null).toLowerCase();
    expect(line).toContain("next 7 sessions");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Environment Summary
// ─────────────────────────────────────────────────────────────────────────────

describe("buildEnvironmentSummary (Phase 2b)", () => {
  test("joins all four signals into one strategy-agnostic sentence", () => {
    const s = buildEnvironmentSummary(1.5, "Contained", "Broad", "Elevated").toLowerCase();
    expect(s).toContain("short-horizon price drift up");
    expect(s).toContain("volatility contained");
    expect(s).toContain("participation broad");
    expect(s).toContain("macro risk approaching");
  });

  test("drift maps to 'down' when avg pct5d <= -0.6", () => {
    const s = buildEnvironmentSummary(-1.5, "Contained", "Mixed", "Quiet").toLowerCase();
    expect(s).toContain("short-horizon price drift down");
  });

  test("drift maps to 'mixed' for the in-between band", () => {
    const s = buildEnvironmentSummary(0.1, "Contained", "Mixed", "Quiet").toLowerCase();
    expect(s).toContain("short-horizon price drift mixed");
  });

  test("drift maps to 'unknown' when avg pct5d is null", () => {
    const s = buildEnvironmentSummary(null, "Contained", "Mixed", "Quiet").toLowerCase();
    expect(s).toContain("short-horizon price drift unknown");
  });

  test("Active risk maps to 'earnings risk approaching' not 'macro risk approaching'", () => {
    // Risk Horizon=Active reflects earnings density, NOT macro events. The
    // summary phrase must distinguish those — confusing them would imply a
    // Fed event when there is only an earnings cluster.
    const s = buildEnvironmentSummary(0.7, "Contained", "Mixed", "Active").toLowerCase();
    expect(s).toContain("earnings risk approaching");
    expect(s).not.toContain("macro risk approaching");
  });

  test("strategy-agnostic — banned evaluative words never appear", () => {
    // Every combination of drift × vol × participation × risk must produce a
    // strategy-agnostic sentence. We sample the high-traffic combinations.
    const drifts = [null, -1.5, 0, 1.5];
    const vols = ["Contained", "Expanding", "Compressed", "Unknown"] as const;
    const parts = ["Broad", "Mixed", "Narrow", "Unknown"] as const;
    const risks = ["Elevated", "Active", "Quiet"] as const;
    const banned = ["setup", "continuation", "trend intact", "constructive", "buy", "sell"];
    for (const d of drifts) {
      for (const v of vols) {
        for (const p of parts) {
          for (const r of risks) {
            const s = buildEnvironmentSummary(d, v, p, r).toLowerCase();
            for (const b of banned) {
              expect(s).not.toContain(b);
            }
          }
        }
      }
    }
  });
});
