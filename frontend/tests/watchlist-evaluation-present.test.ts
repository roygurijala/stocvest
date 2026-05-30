import { describe, expect, test } from "vitest";
import {
  countEvaluatedSymbols,
  evaluationStatusTitle,
  formatLastEvaluatedLine,
  formatLastEvaluatedShort,
  formatSummaryFetchedAt,
  formatUnevaluatedDeskStatusLine,
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

  test("formatLastEvaluatedLine", () => {
    expect(formatLastEvaluatedLine("2026-05-16T16:30:00+00:00")).toMatch(/Last evaluated/);
    expect(formatLastEvaluatedLine(undefined)).toBe("Not evaluated yet");
    expect(formatLastEvaluatedLine(undefined, { evaluating: true })).toBe("Evaluating now…");
    expect(formatLastEvaluatedLine(undefined, { sessionClosed: true })).toMatch(/market is closed/i);
  });

  test("formatUnevaluatedDeskStatusLine when session closed", () => {
    expect(formatUnevaluatedDeskStatusLine("swing", { sessionClosed: true })).toMatch(/market closed/i);
  });

  test("formatSummaryFetchedAt", () => {
    expect(formatSummaryFetchedAt(new Date("2026-05-16T16:30:00+00:00"))).toMatch(/May/);
  });

  test("watchlistMaturationDeskSummary when none evaluated", () => {
    const line = watchlistMaturationDeskSummary(["AAPL"], {}, {}, "swing", false);
    expect(line).toMatch(/No maturation runs/);
    expect(line).toMatch(/Signals/);
  });

  test("watchlistMaturationDeskSummary when session closed", () => {
    const line = watchlistMaturationDeskSummary(["AAPL"], {}, {}, "swing", false, { sessionClosed: true });
    expect(line).toMatch(/Market is closed/);
  });

  test("watchlistMaturationDeskSummary when session closed and rows evaluated", () => {
    const line = watchlistMaturationDeskSummary(
      ["AAPL"],
      { AAPL: { state: "actionable", last_evaluated_at: "2026-05-28T20:00:00Z", layers_aligned: 5, layers_total: 6 } as never },
      {},
      "swing",
      false,
      { sessionClosed: true }
    );
    expect(line).toMatch(/1 of 1/);
    expect(line).toMatch(/Market closed/i);
  });
});
