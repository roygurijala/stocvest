import { describe, expect, test } from "vitest";
import { buildPipelineStatusLine } from "@/lib/dashboard/dashboard-opportunity-pipeline-present";

describe("dashboard-opportunity-pipeline-present", () => {
  test("buildPipelineStatusLine combines watchlist and market counts", () => {
    const line = buildPipelineStatusLine({
      mode: "swing",
      watchlistAttentionCount: 2,
      buildingStructureCount: 3,
      quietLeadersCount: 3,
      marketActivityCount: 5,
      nearReadyInMarket: 1,
      systemSuppressed: false
    });
    expect(line).toContain("2 on your list");
    expect(line).toContain("3 building structure");
    expect(line).toContain("5 active");
    expect(line).toContain("1 near-ready");
  });

  test("buildPipelineStatusLine notes quiet subset when backfilled", () => {
    const line = buildPipelineStatusLine({
      mode: "swing",
      watchlistAttentionCount: 0,
      buildingStructureCount: 6,
      quietLeadersCount: 1,
      marketActivityCount: 10,
      nearReadyInMarket: 0,
      systemSuppressed: false
    });
    expect(line).toContain("6 building structure (1 quiet)");
  });

  test("buildPipelineStatusLine when market closed", () => {
    const line = buildPipelineStatusLine({
      mode: "swing",
      watchlistAttentionCount: 6,
      buildingStructureCount: 8,
      quietLeadersCount: 0,
      marketActivityCount: 15,
      nearReadyInMarket: 3,
      systemSuppressed: true,
      sessionMode: "closed"
    });
    expect(line.toLowerCase()).toContain("market closed");
  });

  test("buildPipelineStatusLine when quiet and suppressed", () => {
    const line = buildPipelineStatusLine({
      mode: "day",
      watchlistAttentionCount: 0,
      buildingStructureCount: 0,
      quietLeadersCount: 0,
      marketActivityCount: 0,
      nearReadyInMarket: 0,
      systemSuppressed: true
    });
    expect(line.toLowerCase()).toContain("gated");
  });
});
