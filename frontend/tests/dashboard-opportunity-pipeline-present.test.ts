import { describe, expect, test } from "vitest";
import { buildPipelineStatusLine } from "@/lib/dashboard/dashboard-opportunity-pipeline-present";

describe("dashboard-opportunity-pipeline-present", () => {
  test("buildPipelineStatusLine combines watchlist and market counts", () => {
    const line = buildPipelineStatusLine({
      mode: "swing",
      watchlistAttentionCount: 2,
      quietLeadersCount: 3,
      marketActivityCount: 5,
      nearReadyInMarket: 1,
      systemSuppressed: false
    });
    expect(line).toContain("2 on your list");
    expect(line).toContain("3 quiet leaders");
    expect(line).toContain("5 active");
    expect(line).toContain("1 near-ready");
  });

  test("buildPipelineStatusLine when quiet and suppressed", () => {
    const line = buildPipelineStatusLine({
      mode: "day",
      watchlistAttentionCount: 0,
      quietLeadersCount: 0,
      marketActivityCount: 0,
      nearReadyInMarket: 0,
      systemSuppressed: true
    });
    expect(line.toLowerCase()).toContain("gated");
  });
});
