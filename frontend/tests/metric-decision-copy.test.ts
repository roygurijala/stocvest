import { describe, expect, test } from "vitest";
import { riskRewardEntryDecisionTooltip } from "@/lib/metric-decision-copy";

describe("metric-decision-copy", () => {
  test("riskRewardEntryDecisionTooltip includes ratio and 2:1 gate", () => {
    const t = riskRewardEntryDecisionTooltip(3.5);
    expect(t).toMatch(/3\.5:1/);
    expect(t).toMatch(/2:1/);
  });
});
