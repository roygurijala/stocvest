import { describe, expect, test } from "vitest";
import {
  evaluationStatusTitle,
  formatLastEvaluatedShort,
  newestLastEvaluatedAt
} from "@/lib/watchlist-evaluation-present";

describe("watchlist-evaluation-present", () => {
  test("evaluationStatusTitle", () => {
    expect(evaluationStatusTitle("swing")).toBe("Swing evaluation status");
    expect(evaluationStatusTitle("day")).toBe("Day evaluation status");
  });

  test("newestLastEvaluatedAt picks latest", () => {
    const label = newestLastEvaluatedAt({
      AAPL: { last_evaluated_at: "2026-05-15T12:00:00+00:00" },
      TSLA: { last_evaluated_at: "2026-05-16T12:00:00+00:00" }
    });
    expect(label).toBeTruthy();
  });

  test("formatLastEvaluatedShort", () => {
    expect(formatLastEvaluatedShort("2026-05-16T16:30:00+00:00")).toMatch(/May/);
  });
});
