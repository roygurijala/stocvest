import { describe, expect, test } from "vitest";
import {
  buildDashboardPageTitle,
  discoveryWhyLine,
  formatDeskGapLine,
  gapIntelToDiscoveryLeaders,
  resolveDiscoveryLeaders
} from "@/lib/dashboard/desk-today-present";
import type { GapIntelligenceItem } from "@/lib/api/scanner";

describe("desk-today-present", () => {
  test("resolveDiscoveryLeaders prefers desk cache", () => {
    const leaders = resolveDiscoveryLeaders(
      { discovery: [{ symbol: "MU", gap_percent: 10, direction: "up", rank_score: 10, desk: "swing" }] },
      [],
      "swing"
    );
    expect(leaders.source).toBe("desk_cache");
    expect(leaders.leaders[0]?.symbol).toBe("MU");
  });

  test("resolveDiscoveryLeaders falls back to movers radar when discovery is empty", () => {
    const leaders = resolveDiscoveryLeaders(
      {
        discovery: [],
        movers_radar: [{ symbol: "NVDA", gap_percent: 8, direction: "up", rank_score: 8 }]
      },
      [],
      "day"
    );
    expect(leaders.source).toBe("movers_radar");
    expect(leaders.leaders[0]?.symbol).toBe("NVDA");
  });

  test("resolveDiscoveryLeaders falls back to gap intel", () => {
    const gap: GapIntelligenceItem = {
      symbol: "AAA",
      company_name: "A",
      gap_pct: 5,
      gap_dollars: 1,
      gap_quality_score: 8,
      has_catalyst: false
    };
    const leaders = resolveDiscoveryLeaders(null, [gap], "swing");
    expect(leaders.source).toBe("gap_fallback");
    expect(leaders.leaders[0]?.symbol).toBe("AAA");
  });

  test("discoveryWhyLine includes execution hint", () => {
    const line = discoveryWhyLine({
      symbol: "MU",
      gap_percent: 16,
      direction: "up",
      rank_score: 16,
      desk: "swing",
      execution_hint: "blocked by R/R"
    });
    expect(line).toContain("blocked by R/R");
    expect(line).toContain("+16.0%");
  });

  test("formatDeskGapLine tolerates non-finite gap percent", () => {
    expect(formatDeskGapLine(Number.NaN, "up")).toContain("0.0%");
  });

  test("buildDashboardPageTitle includes weekday and regime", () => {
    const title = buildDashboardPageTitle("Risk-on");
    expect(title).toContain("Risk-on");
    expect(title.length).toBeGreaterThan(5);
  });
});
