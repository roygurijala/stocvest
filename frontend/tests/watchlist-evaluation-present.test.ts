import { describe, expect, test } from "vitest";
import {
  countEvaluatedSymbols,
  evaluationStatusTitle,
  formatLastEvaluatedShort,
  newestLastEvaluatedAt,
  watchlistMaturationDeskSummary
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

  test("countEvaluatedSymbols respects view mode", () => {
    const swing = { AAPL: { state: "developing" }, MSFT: {} };
    expect(countEvaluatedSymbols(["AAPL", "MSFT"], swing, {}, "swing", false)).toEqual({
      evaluated: 1,
      total: 2
    });
  });

  test("watchlistMaturationDeskSummary when none evaluated", () => {
    const line = watchlistMaturationDeskSummary(["AAPL"], {}, {}, "swing", false);
    expect(line).toMatch(/No maturation runs/);
    expect(line).toMatch(/Signals/);
  });
});
