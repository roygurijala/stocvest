import { describe, expect, test } from "vitest";
import {
  buildEvidenceRiskHorizonFactors,
  buildFundamentalBackdropBullets,
  buildFundamentalBackdropSummary,
  buildFundamentalConvictionNote,
  revenueTrendInterpretation
} from "@/lib/signal-evidence/fundamental-present";
import type { SignalEvidenceFundamentalContext } from "@/lib/signal-evidence";

function ctx(partial: Partial<SignalEvidenceFundamentalContext>): SignalEvidenceFundamentalContext {
  return {
    backdrop: "weak",
    earnings_trend: "missing",
    guidance_direction: "unknown",
    analyst_direction: "unknown",
    revenue_trend: "declining",
    summary_line: "Weak fundamental backdrop. Signal data only.",
    data_quality: "medium",
    quarters_beating: 0,
    quarters_missing: 2,
    recent_upgrades: 0,
    recent_downgrades: 1,
    sector_display_name: null,
    sector_etf: null,
    ...partial
  };
}

describe("fundamental-present", () => {
  test("revenueTrendInterpretation adds supportive or tailwind copy", () => {
    expect(revenueTrendInterpretation("growing")).toBe("Growing (supportive backdrop)");
    expect(revenueTrendInterpretation("declining")).toBe("Declining (negative tailwind)");
  });

  test("buildFundamentalBackdropBullets uses short copy", () => {
    const bullets = buildFundamentalBackdropBullets({
      context: ctx({ backdrop: "weak" }),
      earningsDaysAway: 3,
      earningsRisk: "elevated",
      newsStatus: "Neutral"
    });
    expect(bullets).toContain("Revenue trend declining");
    expect(bullets).toContain("No positive catalyst");
    expect(bullets).toContain("Earnings risk upcoming");
    expect(bullets.some((b) => b.includes("negative tailwind"))).toBe(false);
  });

  test("buildFundamentalBackdropSummary weak with conviction note when actionable", () => {
    const summary = buildFundamentalBackdropSummary({
      context: ctx({ backdrop: "weak" }),
      earningsDaysAway: 3,
      earningsRisk: "elevated",
      newsStatus: "Neutral",
      setupActionable: true
    });
    expect(summary?.headline).toBe("Fundamental backdrop: Weak");
    expect(summary?.convictionNote).toBe(buildFundamentalConvictionNote("weak", true));
  });

  test("neutral backdrop gets conviction note", () => {
    expect(buildFundamentalConvictionNote("neutral", false)).toMatch(/layer alignment remains primary/i);
  });

  test("buildEvidenceRiskHorizonFactors omits earnings when banner covers them", () => {
    const factors = buildEvidenceRiskHorizonFactors({
      context: ctx({ revenue_trend: "declining" }),
      earningsDaysAway: 3,
      earningsRisk: "elevated",
      omitEarnings: true
    });
    expect(factors).not.toContain("Earnings in 3 days");
    expect(factors).toContain("Weak revenue trend increases downside sensitivity");
  });

  test("buildEvidenceRiskHorizonFactors includes macro warnings", () => {
    const factors = buildEvidenceRiskHorizonFactors({
      context: null,
      omitEarnings: true,
      macroWarnings: ["⚠️ FOMC in 45 minutes"]
    });
    expect(factors).toContain("⚠️ FOMC in 45 minutes");
  });
});
